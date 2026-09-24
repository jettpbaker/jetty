import type { Project, ProviderId, ThreadMeta } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import type { Store, EnvironmentRecord, ContainerRegistration } from './store'

export type ContainerRecipe = {
  version: 1
  image: string
  setup: string
  dev: { name: string; command: string; port: number; readyPath: string }[]
  verify: string
  requiredEnv: string[]
}
export type ContainerSettings = {
  maxRunning: number
  cpus: number
  memoryGiB: number
  memoryBudgetGiB: number
  idleMinutes: number
  previewUrlTemplate?: string
}
export type ContainerTarget = {
  containerId: string
  hostCheckout: string
  agentCwd: '/workspace'
  home: string
  artifacts: string
  providerEnv: Record<string, string>
}
type RunningContainer = {
  containerId: string
  active: number
  idle?: ReturnType<typeof setTimeout>
  busyTimer?: ReturnType<typeof setTimeout>
  pendingFinishes?: number
  busyCheck?: () => boolean
}

export const containerDefaults: ContainerSettings = {
  maxRunning: 2,
  cpus: 2,
  memoryGiB: 8,
  memoryBudgetGiB: 16,
  idleMinutes: 10,
}

async function command(binary: string, args: string[], cwd?: string, signal?: AbortSignal) {
  const bounded = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    : AbortSignal.timeout(30_000)
  const child = Bun.spawn([binary, ...args], {
    cwd,
    signal: bounded,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`${binary}: ${stderr.trim() || stdout.trim() || `exit ${code}`}`)
  return stdout.trim()
}

export async function gitCommit(path: string, ref = 'HEAD') {
  if (ref.startsWith('-') || ref.includes('\0')) throw new Error('Invalid Git ref')
  return command('git', ['rev-parse', '--verify', `${ref}^{commit}`], path)
}

async function recipeFor(project: Project) {
  const path = join(project.path, '.jetty/container.json')
  const raw = await readFile(path)
  const value: unknown = JSON.parse(raw.toString())
  if (!value || typeof value !== 'object') throw new Error('Invalid container recipe')
  const recipe = value as ContainerRecipe
  if (
    recipe.version !== 1 ||
    !recipe.image ||
    typeof recipe.setup !== 'string' ||
    typeof recipe.verify !== 'string' ||
    !Array.isArray(recipe.dev) ||
    !Array.isArray(recipe.requiredEnv) ||
    recipe.dev.some(
      (service) =>
        !service.name ||
        !service.command ||
        !Number.isInteger(service.port) ||
        service.port < 1 ||
        service.port > 65535 ||
        !service.readyPath.startsWith('/')
    ) ||
    recipe.requiredEnv.some((name) => !/^[A-Z][A-Z0-9_]*$/.test(name))
  )
    throw new Error('Invalid .jetty/container.json')
  return { recipe, hash: createHash('sha256').update(raw).digest('hex') }
}

async function loadSettings(home: string): Promise<ContainerSettings> {
  const local = await readFile(join(home, 'containers.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))
  const maxRunning = local.maxRunning ?? containerDefaults.maxRunning
  const dockerBytes = Number(
    await command('docker', ['info', '--format', '{{.MemTotal}}']).catch(() => 0)
  )
  const usableGiB = Math.min(
    local.memoryBudgetGiB ?? containerDefaults.memoryBudgetGiB,
    Math.max(0, dockerBytes / 2 ** 30 - 1)
  )
  const defaultMemory = dockerBytes
    ? Math.max(1, Math.min(8, Math.floor(usableGiB / maxRunning)))
    : containerDefaults.memoryGiB
  const settings = {
    ...containerDefaults,
    ...local,
    memoryGiB: local.memoryGiB ?? defaultMemory,
  } as ContainerSettings
  if (
    !Number.isInteger(settings.maxRunning) ||
    settings.maxRunning < 1 ||
    !Number.isFinite(settings.cpus) ||
    settings.cpus <= 0 ||
    !Number.isFinite(settings.memoryGiB) ||
    settings.memoryGiB <= 0 ||
    settings.memoryBudgetGiB <= 0 ||
    settings.idleMinutes < 0
  )
    throw new Error('Invalid container limits')
  return settings
}

async function localProjectConfig(home: string, projectId: string) {
  const path = join(home, 'projects', projectId, 'container.local.json')
  const value = (await readFile(path, 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))) as {
    envFile?: string
    copyFiles?: string[]
    homeFiles?: string[]
  }
  return value
}

async function hasConfiguredEnv(local: { envFile?: string }, name: string) {
  if (!local.envFile) return false
  const contents = await readFile(local.envFile, 'utf8').catch(() => '')
  return contents.split('\n').some((line) => line.trimStart().startsWith(`${name}=`))
}

async function containerEnvFile(local: { envFile?: string }, homePath: string, required: string[]) {
  const values = await localEnvValues(local)
  for (const name of required)
    if (!values.has(name)) throw new Error(`Missing container value for ${name}`)
  for (const name of providerCredentialNames) values.delete(name)
  const path = join(homePath, '.jetty-env')
  await writeFile(path, [...values].map(([name, value]) => `${name}=${value}`).join('\n') + '\n', {
    mode: 0o600,
  })
  return path
}

const providerCredentialNames = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
]

async function localEnvValues(local: { envFile?: string }) {
  const contents = local.envFile ? await readFile(local.envFile, 'utf8') : ''
  const values = new Map<string, string>()
  for (const line of contents.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (match) values.set(match[1]!, match[2]!)
  }
  return values
}

async function providerEnv(local: { envFile?: string }, provider?: ProviderId) {
  const allowed =
    provider === 'claude'
      ? ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']
      : provider === 'codex'
        ? ['OPENAI_API_KEY']
        : provider === 'grok'
          ? ['XAI_API_KEY']
          : []
  const values = await localEnvValues(local)
  return Object.fromEntries([...values].filter(([name]) => allowed.includes(name)))
}

async function populateCheckout(
  project: Project,
  checkoutPath: string,
  local: { copyFiles?: string[] }
) {
  for (const relative of local.copyFiles ?? []) {
    const source = resolve(project.path, relative)
    if (!source.startsWith(resolve(project.path) + '/')) throw new Error('Invalid copyFiles path')
    const target = resolve(checkoutPath, relative)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { recursive: true, force: false })
  }
}

async function populateHome(homePath: string, local: { homeFiles?: string[] }) {
  const host = homedir()
  for (const entry of local.homeFiles ?? []) {
    const source = resolve(host, entry.replace(/^~(?=\/|$)/, host))
    if (!source.startsWith(host + '/')) throw new Error('Invalid homeFiles path')
    const target = join(homePath, relative(host, source))
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { recursive: true, force: false, dereference: true })
  }
}

async function waitReady(name: string, check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await Bun.sleep(500)
    if (await check()) return
  }
  throw new Error(`${name} did not become ready`)
}

export function createEnvironmentManager(
  store: Store,
  home: string,
  runStore: <A, E = unknown>(effect: Effect.Effect<A, E>) => Promise<A>
) {
  const installation = createHash('sha256').update(resolve(home)).digest('hex').slice(0, 16)
  const running = new Map<string, RunningContainer>()
  const stopping = new Map<string, Promise<void>>()
  const preparing = new Map<string, Promise<unknown>>()
  const cancelled = new Set<string>()
  const waiting: { threadId?: string; resolve: () => void }[] = []
  const controllers = new Map<string, AbortController>()
  let reserved = 0
  let previousTest = Promise.resolve()

  async function settings() {
    return loadSettings(home)
  }
  async function setLimits(limits: Pick<ContainerSettings, 'maxRunning' | 'cpus' | 'memoryGiB'>) {
    if (
      !Number.isInteger(limits.maxRunning) ||
      limits.maxRunning < 1 ||
      limits.maxRunning > 32 ||
      !Number.isFinite(limits.cpus) ||
      limits.cpus <= 0 ||
      !Number.isFinite(limits.memoryGiB) ||
      limits.memoryGiB < 1
    )
      throw new Error('Invalid container limits')
    const current = await readFile(join(home, 'containers.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => ({}))
    const next = { ...current, ...limits }
    await writeFile(join(home, 'containers.json'), JSON.stringify(next, null, 2) + '\n', {
      mode: 0o600,
    })
    for (const waiter of waiting.splice(0)) waiter.resolve()
    return settings()
  }
  async function capacity(config: ContainerSettings) {
    const dockerBytes = Number(await command('docker', ['info', '--format', '{{.MemTotal}}']))
    const usableGiB = Math.min(config.memoryBudgetGiB, Math.max(0, dockerBytes / 2 ** 30 - 1))
    if (config.memoryGiB > usableGiB)
      throw new Error(
        `Container needs ${config.memoryGiB} GiB; Docker has ${usableGiB.toFixed(1)} GiB usable. Lower memory per container in Settings → Containers.`
      )
    return {
      usableGiB,
      slots: Math.min(config.maxRunning, Math.floor(usableGiB / config.memoryGiB)),
    }
  }
  async function refreshRunning() {
    for (const [threadId, entry] of running) {
      const alive = await command('docker', [
        'inspect',
        '--format',
        '{{.State.Running}}',
        entry.containerId,
      ])
        .then((value) => value === 'true')
        .catch((error) => {
          if (String(error).includes('No such object')) return false
          throw error
        })
      if (alive || stopping.has(threadId) || running.get(threadId) !== entry) continue
      await command('docker', ['rm', '-f', entry.containerId]).catch(() => {})
      if (entry.idle) clearTimeout(entry.idle)
      if (entry.busyTimer) clearTimeout(entry.busyTimer)
      running.delete(threadId)
      reserved--
      const record = await runStore<EnvironmentRecord | null>(store.getEnvironment(threadId))
      if (record)
        await runStore(store.saveEnvironment({ ...record, containerId: null, state: 'stopped' }))
      wake()
    }
  }
  async function status() {
    const config = await settings()
    const docker = await command('docker', ['info', '--format', '{{.ServerVersion}}'])
      .then(() => true)
      .catch(() => false)
    if (docker) await refreshRunning()
    const availableGiB = docker
      ? Math.min(
          config.memoryBudgetGiB,
          Math.max(
            0,
            Number(await command('docker', ['info', '--format', '{{.MemTotal}}'])) / 2 ** 30 - 1
          )
        )
      : null
    const retained = await runStore<EnvironmentRecord[]>(store.listEnvironments())
    const projects = await runStore<Project[]>(store.listProjects())
    const locals = await Promise.all(
      projects.map((project) => localProjectConfig(home, project.id))
    )
    const configured = async (name: string) =>
      (await Promise.all(locals.map((local) => hasConfiguredEnv(local, name)))).some(Boolean)
    return {
      enabled: true,
      docker,
      availableGiB,
      ...config,
      credentials: {
        codex: Boolean(await stat(join(homedir(), '.codex', 'auth.json')).catch(() => null)),
        claude: await configured('CLAUDE_CODE_OAUTH_TOKEN'),
        grok: await configured('XAI_API_KEY'),
      },
      running: running.size,
      retained: retained.map((record) => ({
        threadId: record.threadId,
        state: record.state,
        checkoutPath: record.checkoutPath,
        lastError: record.lastError,
      })),
    }
  }
  function wake() {
    waiting.shift()?.resolve()
  }
  async function stopNow(threadId: string) {
    const current = running.get(threadId)
    if (!current) return
    if (current.idle) clearTimeout(current.idle)
    if (current.busyTimer) clearTimeout(current.busyTimer)
    await command('docker', ['rm', '-f', current.containerId]).catch(async (error) => {
      await command('docker', ['info', '--format', '{{.ServerVersion}}'])
      const exists = await command('docker', ['inspect', current.containerId])
        .then(() => true)
        .catch(() => false)
      if (exists) throw error
    })
    if (running.get(threadId) !== current) return
    running.delete(threadId)
    reserved--
    const record = await runStore<EnvironmentRecord | null>(store.getEnvironment(threadId))
    if (record)
      await runStore(store.saveEnvironment({ ...record, containerId: null, state: 'stopped' }))
    wake()
  }
  function stop(threadId: string) {
    const pending = stopping.get(threadId)
    if (pending) return pending
    const task = Promise.resolve(preparing.get(threadId))
      .catch(() => {})
      .then(() => stopNow(threadId))
      .finally(() => {
        stopping.delete(threadId)
        cancelled.delete(threadId)
      })
    stopping.set(threadId, task)
    return task
  }
  async function interruptProvider(threadId: string) {
    const entry = running.get(threadId)
    if (!entry) return
    try {
      await command('docker', [
        'exec',
        entry.containerId,
        'sh',
        '-lc',
        'pid=$(cat /artifacts/.jetty-provider.pid 2>/dev/null) || exit 0; args=$(ps -o args= -p "$pid"); [ -n "$args" ] || exit 0; case "$args" in *codex*|*claude*|*grok*) ;; *) exit 1;; esac; pgid=$(ps -o pgid= -p "$pid" | tr -d " "); [ -n "$pgid" ] || exit 0; if [ "$pgid" = "$pid" ]; then kill -TERM "-$pgid" || [ ! -d "/proc/$pid" ]; else pkill -TERM -P "$pid" 2>/dev/null || true; kill -TERM "$pid" || [ ! -d "/proc/$pid" ]; fi',
      ])
    } catch {
      await stop(threadId)
    }
  }
  function cancel(threadId: string) {
    if (!preparing.has(threadId)) return
    cancelled.add(threadId)
    controllers.get(threadId)?.abort()
    const index = waiting.findIndex((waiter) => waiter.threadId === threadId)
    if (index >= 0) waiting.splice(index, 1)[0]?.resolve()
  }
  function checkCancelled(threadId: string) {
    if (cancelled.has(threadId)) throw new Error('Container start cancelled')
  }
  async function admit(threadId?: string) {
    while (true) {
      if (threadId) checkCancelled(threadId)
      const limit = await settings()
      const available = await capacity(limit)
      if (reserved < available.slots) {
        reserved++
        return
      }
      const idle = [...running].find(([, entry]) => !entry.active)
      if (idle) {
        await stop(idle[0])
        continue
      }
      await new Promise<void>((resolve) => waiting.push({ threadId, resolve }))
    }
  }
  async function registration(project: Project) {
    const { recipe, hash } = await recipeFor(project)
    const saved = await runStore<ContainerRegistration | null>(
      store.getContainerRegistration(project.id)
    )
    if (!saved?.valid || saved.manifestHash !== hash)
      throw new Error('Test the project container configuration first')
    const imageId = await command('docker', [
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      recipe.image,
    ])
    if (imageId !== saved.imageId)
      throw new Error('Container image changed; test configuration again')
    return { recipe, imageId, providers: saved.providers }
  }
  async function setupStatus(project: Project) {
    let capacityError: string | null = null
    try {
      await capacity(await settings())
    } catch (error) {
      capacityError = String(error).replace(/^Error: /, '')
    }
    let imageReady = false
    try {
      const { recipe } = await recipeFor(project)
      imageReady = await command('docker', ['image', 'inspect', recipe.image])
        .then(() => true)
        .catch(() => false)
    } catch {
      // The setup thread creates the manifest and image.
    }
    return { imageReady, capacityError }
  }
  async function provision(
    threadId: string,
    project: Project,
    baseCommit: string,
    signal: AbortSignal
  ) {
    const { recipe, imageId } = await registration(project)
    const id = randomUUID()
    const root = join(home, 'environments', id)
    const checkoutPath = join(root, 'checkout')
    const homePath = join(root, 'home')
    const artifactsPath = join(root, 'artifacts')
    try {
      await mkdir(root, { recursive: true })
      await command(
        'git',
        ['clone', '--no-local', '--no-checkout', project.path, checkoutPath],
        undefined,
        signal
      )
      checkCancelled(threadId)
      await command(
        'git',
        ['cat-file', '-e', `${baseCommit}^{commit}`],
        checkoutPath,
        signal
      ).catch(() =>
        command('git', ['fetch', '--no-tags', project.path, baseCommit], checkoutPath, signal)
      )
      checkCancelled(threadId)
      await command(
        'git',
        ['checkout', '-b', `jetty/${threadId}`, baseCommit],
        checkoutPath,
        signal
      )
      const upstream = await command('git', ['remote', 'get-url', 'origin'], project.path).catch(
        () => ''
      )
      if (upstream) await command('git', ['remote', 'set-url', 'origin', upstream], checkoutPath)
      else await command('git', ['remote', 'remove', 'origin'], checkoutPath)
      await Promise.all([mkdir(homePath), mkdir(artifactsPath)])
      const local = await localProjectConfig(home, project.id)
      await populateCheckout(project, checkoutPath, local)
      await populateHome(homePath, local)
      const record: EnvironmentRecord = {
        id,
        threadId,
        recipeJson: JSON.stringify(recipe),
        imageId,
        baseCommit,
        checkoutPath,
        homePath,
        artifactsPath,
        containerId: null,
        state: 'provisioned',
        lastError: null,
      }
      await runStore(store.saveEnvironment(record))
      return record
    } catch (error) {
      await rm(root, { recursive: true, force: true })
      throw error
    }
  }
  async function start(record: EnvironmentRecord, projectId: string) {
    const limit = await settings()
    const recipe = JSON.parse(record.recipeJson) as ContainerRecipe
    const local = await localProjectConfig(home, projectId)
    const args = await dockerRunArgs(record, recipe, local, limit)
    const containerId = await command('docker', args)
    try {
      const next = { ...record, containerId, state: 'running', lastError: null }
      await runStore(store.saveEnvironment(next))
      running.set(record.threadId, { containerId, active: 1 })
      return next
    } catch (error) {
      await command('docker', ['rm', '-f', containerId]).catch(() => {})
      throw error
    }
  }
  async function dockerRunArgs(
    record: EnvironmentRecord,
    recipe: ContainerRecipe,
    local: { envFile?: string },
    limit: ContainerSettings
  ) {
    const envFile = await containerEnvFile(local, record.homePath, recipe.requiredEnv)
    return [
      'run',
      '-d',
      '--init',
      '--name',
      `jetty-${installation}-${record.id}`,
      '--label',
      `jetty.installation=${installation}`,
      '--label',
      `jetty.environment=${record.id}`,
      '--label',
      'jetty.dev=containers-v1',
      '--add-host',
      'host.docker.internal:host-gateway',
      '--cpus',
      String(limit.cpus),
      '--memory',
      `${limit.memoryGiB}g`,
      '--memory-swap',
      `${limit.memoryGiB}g`,
      '--user',
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '--mount',
      `type=bind,src=${record.checkoutPath},dst=/workspace`,
      '--mount',
      `type=bind,src=${record.homePath},dst=/home/jetty`,
      '--mount',
      `type=bind,src=${record.artifactsPath},dst=/artifacts`,
      '-e',
      'HOME=/home/jetty',
      '-e',
      'CODEX_HOME=/home/jetty/.codex',
      '-e',
      'XDG_CONFIG_HOME=/home/jetty/.config',
      '--env-file',
      envFile,
      ...recipe.dev.flatMap((service) => ['-p', `127.0.0.1::${service.port}`]),
      record.imageId,
      'sleep',
      'infinity',
    ]
  }
  async function exec(record: EnvironmentRecord, script: string) {
    return command('docker', ['exec', '-w', '/workspace', record.containerId!, 'sh', '-lc', script])
  }
  async function startDev(threadId: string) {
    const target = await prepare(threadId)
    try {
      const record = await runStore<EnvironmentRecord | null>(store.getEnvironment(threadId))
      if (!record) throw new Error('Environment not found')
      const recipe = JSON.parse(record.recipeJson) as ContainerRecipe
      const limit = await settings()
      const services: { name: string; port: number; url?: string }[] = []
      for (const service of recipe.dev) {
        const mapped = await command('docker', ['port', target.containerId, `${service.port}/tcp`])
        const port = Number(mapped.trim().split(':').at(-1))
        let ready = await fetch(`http://127.0.0.1:${port}${service.readyPath}`)
          .then((response) => response.ok)
          .catch(() => false)
        if (!ready)
          await command('docker', [
            'exec',
            '-d',
            '-w',
            '/workspace',
            target.containerId,
            'sh',
            '-lc',
            `${service.command} > /artifacts/${service.name}.log 2>&1`,
          ])
        if (!ready)
          await waitReady(service.name, () =>
            fetch(`http://127.0.0.1:${port}${service.readyPath}`)
              .then((response) => response.ok)
              .catch(() => false)
          )
        const url = limit.previewUrlTemplate
          ? limit.previewUrlTemplate.replace('{port}', String(port))
          : process.env.CODER_WORKSPACE_ID || process.env.CODER_WORKSPACE_NAME
            ? undefined
            : `http://localhost:${port}`
        services.push({ name: service.name, port, ...(url ? { url } : {}) })
      }
      return services
    } finally {
      await finish(threadId)
    }
  }
  function prepare(threadId: string, provider?: ProviderId): Promise<ContainerTarget> {
    const previous = preparing.get(threadId)
    const task = Promise.resolve(previous)
      .catch(() => {})
      .then(() => prepareNow(threadId, provider))
    preparing.set(threadId, task)
    void task
      .finally(() => {
        if (preparing.get(threadId) === task) {
          preparing.delete(threadId)
          cancelled.delete(threadId)
        }
      })
      .catch(() => {})
    return task
  }
  async function prepareNow(threadId: string, provider?: ProviderId): Promise<ContainerTarget> {
    const controller = new AbortController()
    controllers.set(threadId, controller)
    try {
      return await prepareLocked(threadId, provider, controller.signal)
    } finally {
      controllers.delete(threadId)
    }
  }
  async function prepareLocked(
    threadId: string,
    provider: ProviderId | undefined,
    signal: AbortSignal
  ): Promise<ContainerTarget> {
    await stopping.get(threadId)
    checkCancelled(threadId)
    const thread = await runStore<ThreadMeta>(store.requireThread(threadId))
    const project = await runStore<Project | null>(store.getProject(thread.projectId))
    if (!project) throw new Error('Thread project not found')
    if (provider) {
      const configured = await registration(project)
      if (!configured.providers[provider]) {
        const hint =
          provider === 'claude'
            ? 'CLAUDE_CODE_OAUTH_TOKEN'
            : provider === 'grok'
              ? 'XAI_API_KEY'
              : 'Codex auth.json'
        throw new Error(
          `${provider} container is not ready; configure ${hint} and test the project`
        )
      }
    }
    let record = await runStore<EnvironmentRecord | null>(store.getEnvironment(threadId))
    await stopping.get(threadId)
    checkCancelled(threadId)
    if (record?.containerId && running.has(threadId)) {
      const current = running.get(threadId)!
      if (current.idle) clearTimeout(current.idle)
      current.active++
    } else {
      await admit(threadId)
      try {
        checkCancelled(threadId)
        if (!record) {
          const base = await runStore<string | null>(store.getThreadBaseCommit(threadId))
          if (!base) throw new Error('Container thread has no saved base commit')
          record = await provision(threadId, project, base, signal)
        }
        record = await start(record, project.id)
        checkCancelled(threadId)
        if (
          record.state === 'running' &&
          !(await stat(join(record.homePath, '.jetty-setup-done')).catch(() => null))
        ) {
          const recipe = JSON.parse(record.recipeJson) as ContainerRecipe
          if (recipe.setup)
            await command(
              'docker',
              ['exec', '-w', '/workspace', record.containerId!, 'sh', '-lc', recipe.setup],
              undefined,
              signal
            )
          checkCancelled(threadId)
          await writeFile(join(record.homePath, '.jetty-setup-done'), '')
        }
      } catch (error) {
        if (record?.containerId) await stopNow(threadId)
        else {
          reserved--
          wake()
        }
        if (record)
          await runStore(
            store.saveEnvironment({
              ...record,
              containerId: null,
              state: 'failed',
              lastError: String(error),
            })
          )
        throw error
      }
    }
    try {
      const auth = join(record!.homePath, '.codex', 'auth.json')
      if (provider === 'codex') {
        const source = join(homedir(), '.codex', 'auth.json')
        if (await stat(source).catch(() => null)) {
          await mkdir(dirname(auth), { recursive: true })
          await cp(source, auth)
        }
      } else if (running.get(threadId)?.active === 1) {
        await rm(auth, { force: true })
      }
      const local = await localProjectConfig(home, project.id)
      return {
        containerId: record!.containerId!,
        hostCheckout: record!.checkoutPath,
        agentCwd: '/workspace',
        home: record!.homePath,
        artifacts: record!.artifactsPath,
        providerEnv: await providerEnv(local, provider),
      }
    } catch (error) {
      await finish(threadId).catch(() => {})
      throw error
    }
  }
  async function finish(threadId: string, busy?: () => boolean) {
    const entry = running.get(threadId)
    if (!entry) return
    if (busy?.()) {
      entry.pendingFinishes = (entry.pendingFinishes ?? 0) + 1
      entry.busyCheck = busy
      if (!entry.busyTimer) {
        const poll = () => {
          if (running.get(threadId) !== entry) return
          if (entry.busyCheck?.()) {
            entry.busyTimer = setTimeout(poll, 1000)
            return
          }
          entry.busyTimer = undefined
          entry.active = Math.max(0, entry.active - (entry.pendingFinishes ?? 0))
          entry.pendingFinishes = 0
          void armIdle(threadId, entry).catch(() => {})
        }
        entry.busyTimer = setTimeout(poll, 1000)
      }
      return
    }
    entry.active = Math.max(0, entry.active - 1)
    await armIdle(threadId, entry)
  }
  async function armIdle(threadId: string, entry: RunningContainer) {
    if (entry.active) return
    const limit = await settings()
    entry.idle = setTimeout(() => {
      if (running.get(threadId) !== entry || entry.active) return
      void stop(threadId).catch(async (error) => {
        const record = await runStore<EnvironmentRecord | null>(
          store.getEnvironment(threadId)
        ).catch(() => null)
        if (record)
          await runStore(store.saveEnvironment({ ...record, lastError: String(error) })).catch(
            () => {}
          )
      })
    }, limit.idleMinutes * 60_000)
    wake()
  }
  async function test(project: Project) {
    const previous = previousTest
    let release = () => {}
    previousTest = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await testNow(project)
    } finally {
      release()
    }
  }
  async function testNow(project: Project) {
    const { recipe, hash } = await recipeFor(project)
    const imageId = await command('docker', [
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      recipe.image,
    ])
    const base = await gitCommit(project.path)
    const testId = `test-${randomUUID()}`
    const root = join(home, 'environments', testId)
    await admit()
    let record: EnvironmentRecord | null = null
    try {
      const checkoutPath = join(root, 'checkout')
      await mkdir(root, { recursive: true })
      await command('git', ['clone', '--no-local', '--no-checkout', project.path, checkoutPath])
      await command('git', ['checkout', '--detach', base], checkoutPath)
      const homePath = join(root, 'home')
      const artifactsPath = join(root, 'artifacts')
      await Promise.all([mkdir(homePath), mkdir(artifactsPath)])
      const local = await localProjectConfig(home, project.id)
      await populateCheckout(project, checkoutPath, local)
      await populateHome(homePath, local)
      record = {
        id: testId,
        threadId: testId,
        recipeJson: JSON.stringify(recipe),
        imageId,
        baseCommit: base,
        checkoutPath,
        homePath,
        artifactsPath,
        containerId: null,
        state: 'provisioned',
        lastError: null,
      }
      const limit = await settings()
      record.containerId = await command(
        'docker',
        await dockerRunArgs(record, recipe, local, limit)
      )
      const containerId = record.containerId
      const uid = Number(await command('docker', ['exec', record.containerId, 'id', '-u']))
      if (uid === 0) throw new Error('Container must run as a non-root user')
      await exec(
        record,
        'printf jetty-bind-ok > /artifacts/.jetty-bind-sentinel && test -w /workspace && test -w /home/jetty'
      )
      if ((await readFile(join(artifactsPath, '.jetty-bind-sentinel'), 'utf8')) !== 'jetty-bind-ok')
        throw new Error('Docker bind mounts are not shared with Jetty')
      if (recipe.setup) await exec(record, recipe.setup)
      if (recipe.verify) await exec(record, recipe.verify)
      for (const service of recipe.dev) {
        await command('docker', [
          'exec',
          '-d',
          '-w',
          '/workspace',
          record.containerId,
          'sh',
          '-lc',
          `${service.command} > /artifacts/${service.name}.log 2>&1`,
        ])
        await waitReady(service.name, () =>
          command('docker', [
            'exec',
            containerId,
            'sh',
            '-lc',
            `curl -fsS http://127.0.0.1:${service.port}${service.readyPath} >/dev/null`,
          ])
            .then(() => true)
            .catch(() => false)
        )
        const mapped = await command('docker', ['port', record.containerId, `${service.port}/tcp`])
        const port = Number(mapped.trim().split(':').at(-1))
        const hostReady = await fetch(`http://127.0.0.1:${port}${service.readyPath}`)
          .then((response) => response.ok)
          .catch(() => false)
        if (!hostReady) throw new Error(`${service.name} is not reachable from the host`)
      }
      const registration: ContainerRegistration = {
        valid: true,
        manifestHash: hash,
        imageId,
        validatedAt: Date.now(),
        providers: {
          codex:
            Boolean(await stat(join(homedir(), '.codex', 'auth.json')).catch(() => null)) &&
            (await command('docker', [
              'exec',
              record.containerId,
              'sh',
              '-lc',
              'command -v codex && codex --version',
            ])
              .then(() => true)
              .catch(() => false)),
          claude:
            (await hasConfiguredEnv(local, 'CLAUDE_CODE_OAUTH_TOKEN')) &&
            (await command('docker', [
              'exec',
              record.containerId,
              'sh',
              '-lc',
              'command -v claude && claude --version',
            ])
              .then(() => true)
              .catch(() => false)),
          grok:
            (await hasConfiguredEnv(local, 'XAI_API_KEY')) &&
            (await command('docker', [
              'exec',
              record.containerId,
              'sh',
              '-lc',
              'command -v grok && grok --version',
            ])
              .then(() => true)
              .catch(() => false)),
        },
        result: `Verified ${base.slice(0, 12)}`,
        devCount: recipe.dev.length,
      }
      await runStore(store.setContainerRegistration(project.id, registration))
      return registration
    } finally {
      if (record?.containerId)
        await command('docker', ['rm', '-f', record.containerId]).catch(() => {})
      await rm(root, { recursive: true, force: true })
      reserved--
      wake()
    }
  }
  async function reconcile() {
    const ids = await command('docker', [
      'ps',
      '-aq',
      '--filter',
      `label=jetty.installation=${installation}`,
    ]).catch(() => null)
    if (ids === null) return
    for (const id of ids.split('\n').filter(Boolean))
      await command('docker', ['rm', '-f', id]).catch(() => {})
    for (const record of await runStore<EnvironmentRecord[]>(store.listEnvironments()))
      if (record.containerId)
        await runStore(store.saveEnvironment({ ...record, containerId: null, state: 'stopped' }))
  }
  async function shutdown() {
    for (const entry of running.values()) {
      if (entry.idle) clearTimeout(entry.idle)
      if (entry.busyTimer) clearTimeout(entry.busyTimer)
    }
    await reconcile()
    running.clear()
    reserved = 0
  }
  async function remove(threadId: string) {
    await stop(threadId)
    const record = await runStore<EnvironmentRecord | null>(store.getEnvironment(threadId))
    if (record) await rm(dirname(record.checkoutPath), { recursive: true, force: true })
  }
  return {
    settings,
    setLimits,
    status,
    setupStatus,
    registration,
    prepare,
    cancel,
    finish,
    stop,
    interruptProvider,
    remove,
    startDev,
    test,
    reconcile,
    shutdown,
    record: (threadId: string) =>
      runStore<EnvironmentRecord | null>(store.getEnvironment(threadId)),
  }
}
export type EnvironmentManager = ReturnType<typeof createEnvironmentManager>
