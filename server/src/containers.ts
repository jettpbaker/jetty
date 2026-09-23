import type { Project, ProviderId, ThreadMeta } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

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
}

const defaults: ContainerSettings = {
  maxRunning: 2,
  cpus: 2,
  memoryGiB: 8,
  memoryBudgetGiB: 16,
  idleMinutes: 10,
}

async function command(binary: string, args: string[], cwd?: string) {
  const child = Bun.spawn([binary, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
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
  const settings = { ...defaults, ...local } as ContainerSettings
  if (
    !Number.isInteger(settings.maxRunning) ||
    settings.maxRunning < 1 ||
    settings.cpus <= 0 ||
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
  }
  return value
}

async function hasConfiguredEnv(local: { envFile?: string }, name: string) {
  if (process.env[name]) return true
  if (!local.envFile) return false
  const contents = await readFile(local.envFile, 'utf8').catch(() => '')
  return contents.split('\n').some((line) => line.trimStart().startsWith(`${name}=`))
}

async function populateCheckout(
  project: Project,
  checkoutPath: string,
  homePath: string,
  local: { copyFiles?: string[] }
) {
  for (const relative of local.copyFiles ?? []) {
    const source = resolve(project.path, relative)
    if (!source.startsWith(resolve(project.path) + '/')) throw new Error('Invalid copyFiles path')
    const target = resolve(checkoutPath, relative)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { recursive: true, force: false })
  }
  const auth = join(homedir(), '.codex', 'auth.json')
  if (await stat(auth).catch(() => null)) {
    const codexHome = join(homePath, '.codex')
    await mkdir(codexHome, { recursive: true })
    await cp(auth, join(codexHome, 'auth.json'))
  }
}

export function createEnvironmentManager(
  store: Store,
  home: string,
  runStore: <A, E = unknown>(effect: Effect.Effect<A, E>) => Promise<A>
) {
  const installation = createHash('sha256').update(resolve(home)).digest('hex').slice(0, 16)
  const running = new Map<
    string,
    { containerId: string; active: boolean; idle?: ReturnType<typeof setTimeout> }
  >()
  const stopping = new Map<string, Promise<void>>()
  const waiting: (() => void)[] = []
  let reserved = 0
  let previousTest = Promise.resolve()

  async function settings() {
    return loadSettings(home)
  }
  async function setMaxRunning(maxRunning: number) {
    const next = { ...(await settings()), maxRunning }
    await writeFile(join(home, 'containers.json'), JSON.stringify(next, null, 2) + '\n', {
      mode: 0o600,
    })
    wake()
    return next
  }
  async function status() {
    const config = await settings()
    const docker = await command('docker', ['info', '--format', '{{.ServerVersion}}'])
      .then(() => true)
      .catch(() => false)
    const retained = await runStore<EnvironmentRecord[]>(store.listEnvironments())
    return {
      enabled: true,
      docker,
      ...config,
      credentials: {
        codex: Boolean(await stat(join(homedir(), '.codex', 'auth.json')).catch(() => null)),
        claude: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
        grok: Boolean(process.env.XAI_API_KEY),
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
    waiting.shift()?.()
  }
  async function stopNow(threadId: string) {
    const current = running.get(threadId)
    if (!current) return
    if (current.idle) clearTimeout(current.idle)
    await command('docker', ['rm', '-f', current.containerId]).catch(async (error) => {
      await command('docker', ['info', '--format', '{{.ServerVersion}}'])
      const exists = await command('docker', ['inspect', current.containerId])
        .then(() => true)
        .catch(() => false)
      if (exists) throw error
    })
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
    const task = stopNow(threadId).finally(() => stopping.delete(threadId))
    stopping.set(threadId, task)
    return task
  }
  async function admit() {
    while (true) {
      const limit = await settings()
      const dockerBytes = Number(await command('docker', ['info', '--format', '{{.MemTotal}}']))
      const usableGiB = Math.min(limit.memoryBudgetGiB, Math.max(0, dockerBytes / 2 ** 30 - 1))
      if (limit.memoryGiB > usableGiB)
        throw new Error(
          `Container needs ${limit.memoryGiB} GiB; Docker has ${usableGiB.toFixed(1)} GiB usable`
        )
      const capacity = Math.min(limit.maxRunning, Math.floor(usableGiB / limit.memoryGiB))
      if (reserved < capacity) {
        reserved++
        return
      }
      const idle = [...running].find(([, entry]) => !entry.active)
      if (idle) {
        await stop(idle[0])
        continue
      }
      await new Promise<void>((resolve) => waiting.push(resolve))
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
  async function provision(threadId: string, project: Project, baseCommit: string) {
    const { recipe, imageId } = await registration(project)
    const id = randomUUID()
    const root = join(home, 'environments', id)
    const checkoutPath = join(root, 'checkout')
    const homePath = join(root, 'home')
    const artifactsPath = join(root, 'artifacts')
    try {
      await mkdir(root, { recursive: true })
      await command('git', ['clone', '--no-local', '--no-checkout', project.path, checkoutPath])
      await command('git', ['cat-file', '-e', `${baseCommit}^{commit}`], checkoutPath).catch(() =>
        command('git', ['fetch', '--no-tags', project.path, baseCommit], checkoutPath)
      )
      await command('git', ['checkout', '-b', `jetty/${threadId}`, baseCommit], checkoutPath)
      const upstream = await command('git', ['remote', 'get-url', 'origin'], project.path).catch(
        () => ''
      )
      if (upstream) await command('git', ['remote', 'set-url', 'origin', upstream], checkoutPath)
      else await command('git', ['remote', 'remove', 'origin'], checkoutPath)
      await Promise.all([mkdir(homePath), mkdir(artifactsPath)])
      const local = await localProjectConfig(home, project.id)
      await populateCheckout(project, checkoutPath, homePath, local)
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
    const args = [
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
    ]
    if (local.envFile) args.push('--env-file', local.envFile)
    for (const name of recipe.requiredEnv) {
      if (!(await hasConfiguredEnv(local, name)))
        throw new Error(`Missing container value for ${name}`)
      if (process.env[name]) args.push('-e', name)
    }
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) args.push('-e', 'CLAUDE_CODE_OAUTH_TOKEN')
    if (process.env.XAI_API_KEY) args.push('-e', 'XAI_API_KEY')
    for (const service of recipe.dev) args.push('-p', `127.0.0.1::${service.port}`)
    args.push(record.imageId, 'sleep', 'infinity')
    const containerId = await command('docker', args)
    try {
      const next = { ...record, containerId, state: 'running', lastError: null }
      await runStore(store.saveEnvironment(next))
      running.set(record.threadId, { containerId, active: true })
      return next
    } catch (error) {
      await command('docker', ['rm', '-f', containerId]).catch(() => {})
      throw error
    }
  }
  async function exec(record: EnvironmentRecord, script: string) {
    return command('docker', ['exec', '-w', '/workspace', record.containerId!, 'sh', '-lc', script])
  }
  async function startDev(threadId: string) {
    const active = running.get(threadId)?.active ?? false
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
        for (let attempt = 0; attempt < 30; attempt++) {
          await Bun.sleep(500)
          ready = await fetch(`http://127.0.0.1:${port}${service.readyPath}`)
            .then((response) => response.ok)
            .catch(() => false)
          if (ready) break
        }
        if (!ready) throw new Error(`${service.name} did not become ready`)
        const url = limit.previewUrlTemplate
          ? limit.previewUrlTemplate.replace('{port}', String(port))
          : process.env.CODER_WORKSPACE_ID || process.env.CODER_WORKSPACE_NAME
            ? undefined
            : `http://localhost:${port}`
        services.push({ name: service.name, port, ...(url ? { url } : {}) })
      }
      return services
    } finally {
      if (!active) await finish(threadId)
    }
  }
  async function prepare(threadId: string, provider?: ProviderId): Promise<ContainerTarget> {
    await stopping.get(threadId)
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
    if (record?.containerId && running.has(threadId)) {
      const current = running.get(threadId)!
      if (current.idle) clearTimeout(current.idle)
      current.active = true
    } else {
      await admit()
      try {
        if (!record) {
          const base = await runStore<string | null>(store.getThreadBaseCommit(threadId))
          if (!base) throw new Error('Container thread has no saved base commit')
          record = await provision(threadId, project, base)
        }
        record = await start(record, project.id)
        if (
          record.state === 'running' &&
          !(await stat(join(record.homePath, '.jetty-setup-done')).catch(() => null))
        ) {
          const recipe = JSON.parse(record.recipeJson) as ContainerRecipe
          if (recipe.setup) await exec(record, recipe.setup)
          await writeFile(join(record.homePath, '.jetty-setup-done'), '')
        }
      } catch (error) {
        if (record?.containerId) await stop(threadId)
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
    return {
      containerId: record!.containerId!,
      hostCheckout: record!.checkoutPath,
      agentCwd: '/workspace',
      home: record!.homePath,
      artifacts: record!.artifactsPath,
    }
  }
  async function finish(threadId: string) {
    const entry = running.get(threadId)
    if (!entry) return
    entry.active = false
    const limit = await settings()
    entry.idle = setTimeout(() => {
      void stop(threadId)
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
      await populateCheckout(project, checkoutPath, homePath, local)
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
      // The disposable test has no thread row; Docker state is kept in memory only.
      const limit = await settings()
      const args = [
        'run',
        '-d',
        '--init',
        '--label',
        `jetty.installation=${installation}`,
        '--label',
        `jetty.environment=${testId}`,
        '--label',
        'jetty.dev=containers-v1',
        '--cpus',
        String(limit.cpus),
        '--memory',
        `${limit.memoryGiB}g`,
        '--memory-swap',
        `${limit.memoryGiB}g`,
        '--user',
        `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        '--add-host',
        'host.docker.internal:host-gateway',
        '--mount',
        `type=bind,src=${checkoutPath},dst=/workspace`,
        '--mount',
        `type=bind,src=${homePath},dst=/home/jetty`,
        '--mount',
        `type=bind,src=${artifactsPath},dst=/artifacts`,
        '-e',
        'HOME=/home/jetty',
        '-e',
        'CODEX_HOME=/home/jetty/.codex',
      ]
      if (local.envFile) args.push('--env-file', local.envFile)
      for (const name of recipe.requiredEnv) {
        if (!(await hasConfiguredEnv(local, name)))
          throw new Error(`Missing container value for ${name}`)
        if (process.env[name]) args.push('-e', name)
      }
      if (process.env.CLAUDE_CODE_OAUTH_TOKEN) args.push('-e', 'CLAUDE_CODE_OAUTH_TOKEN')
      if (process.env.XAI_API_KEY) args.push('-e', 'XAI_API_KEY')
      for (const service of recipe.dev) args.push('-p', `127.0.0.1::${service.port}`)
      args.push(imageId, 'sleep', 'infinity')
      record.containerId = await command('docker', args)
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
        const pid = await command('docker', [
          'exec',
          '-d',
          '-w',
          '/workspace',
          record.containerId,
          'sh',
          '-lc',
          `${service.command} > /artifacts/${service.name}.log 2>&1`,
        ])
        void pid
        let ready = false
        for (let attempt = 0; attempt < 30; attempt++) {
          await Bun.sleep(500)
          const response = await command('docker', [
            'exec',
            record.containerId,
            'sh',
            '-lc',
            `curl -fsS http://127.0.0.1:${service.port}${service.readyPath} >/dev/null`,
          ])
            .then(() => true)
            .catch(() => false)
          if (response) {
            ready = true
            break
          }
        }
        if (!ready) throw new Error(`${service.name} did not become ready`)
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
            (await command('docker', ['exec', record.containerId, 'sh', '-lc', 'command -v codex'])
              .then(() => true)
              .catch(() => false)),
          claude:
            (await hasConfiguredEnv(local, 'CLAUDE_CODE_OAUTH_TOKEN')) &&
            (await command('docker', ['exec', record.containerId, 'sh', '-lc', 'command -v claude'])
              .then(() => true)
              .catch(() => false)),
          grok:
            (await hasConfiguredEnv(local, 'XAI_API_KEY')) &&
            (await command('docker', ['exec', record.containerId, 'sh', '-lc', 'command -v grok'])
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
  return {
    settings,
    setMaxRunning,
    status,
    registration,
    prepare,
    finish,
    stop,
    startDev,
    test,
    reconcile,
    record: (threadId: string) =>
      runStore<EnvironmentRecord | null>(store.getEnvironment(threadId)),
  }
}
export type EnvironmentManager = ReturnType<typeof createEnvironmentManager>
