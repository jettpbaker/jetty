import { mkdtemp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fps = 25
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5175/thread-replay.html?capture=1' },
    width: { type: 'string', default: '1000' },
    height: { type: 'string', default: '800' },
    scale: { type: 'string', default: '2' },
    playwright: { type: 'string' },
    chromium: { type: 'string' },
    ffmpeg: { type: 'string', default: process.env.FFMPEG ?? 'ffmpeg' },
    ffprobe: { type: 'string', default: process.env.FFPROBE ?? 'ffprobe' },
    help: { type: 'boolean' },
  },
})

async function command(args: string[]) {
  const result = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', cwd: root })
  const [stdout, stderr, code] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ])
  if (code !== 0) throw new Error(`${args[0]} exited ${code}: ${stderr}`)
  return stdout
}

async function loadPlaywright() {
  const explicit = values.playwright ?? process.env.PLAYWRIGHT_MODULE
  if (explicit) return import(pathToFileURL(resolve(explicit)).href)
  try {
    return await import('playwright')
  } catch {
    const bundled = join(
      homedir(),
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
    )
    return import(pathToFileURL(bundled).href)
  }
}

async function chromiumPath() {
  const explicit = values.chromium ?? process.env.CHROMIUM_EXECUTABLE
  if (explicit) {
    if (!explicit.includes('chrome-headless-shell') || explicit.includes('.app/')) {
      throw new Error('Chromium must be a chrome-headless-shell executable, never a .app.')
    }
    return explicit
  }
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), 'Library/Caches/ms-playwright')
  const candidates = (await readdir(cache))
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const name of candidates) {
    const directory = join(cache, name)
    const shells = (await readdir(directory)).filter((entry) =>
      entry.startsWith('chrome-headless-shell-')
    )
    if (shells[0]) return join(directory, shells[0], 'chrome-headless-shell')
  }
  throw new Error('Set CHROMIUM_EXECUTABLE to an installed chrome-headless-shell executable.')
}

function dimension(value: string) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 2 || result > 7680) {
    throw new Error('Viewport dimensions must be integers between 2 and 7680.')
  }
  return result
}

async function main() {
  if (values.help) {
    console.log(
      'bun scripts/capture-thread-preview.ts [--url URL] [--width 1000] [--height 800] [--scale 2] [--playwright MODULE] [--chromium HEADLESS_SHELL] [--ffmpeg BIN] [--ffprobe BIN]'
    )
    return
  }
  const url = new URL(values.url)
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') {
    throw new Error('Capture requires a local replay URL.')
  }
  url.searchParams.set('capture', '1')
  const size = { width: dimension(values.width), height: dimension(values.height) }
  const scale = Number(values.scale)
  if (!Number.isSafeInteger(scale) || scale < 1 || scale > 3) {
    throw new Error('Capture scale must be 1, 2 or 3.')
  }
  if (size.width * scale > 7680 || size.height * scale > 7680) {
    throw new Error('Scaled capture dimensions must not exceed 7680 pixels.')
  }
  const sourceRevision = (await command(['git', 'rev-parse', 'HEAD'])).trim()
  const playwright = await loadPlaywright()
  const executablePath = await chromiumPath()
  const temporary = await mkdtemp(join(tmpdir(), 'jetty-thread-preview-'))
  let browser
  try {
    browser = await playwright.chromium.launch({
      executablePath,
      headless: true,
      args: ['--use-mock-keychain', '--password-store=basic'],
    })
    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: scale,
      reducedMotion: 'no-preference',
    })
    await context.route('**/*', async (route) => {
      const request = route.request()
      const target = new URL(request.url())
      if (
        target.origin === url.origin ||
        target.protocol === 'data:' ||
        target.protocol === 'blob:'
      ) {
        await route.continue()
      } else {
        await route.abort()
      }
    })
    await context.routeWebSocket('**/*', (socket) => socket.close())
    const page = await context.newPage()
    await page.goto(url.href)
    await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load('14px "Geist Variable"'),
        document.fonts.load('14px "Paper Mono"'),
      ])
      await document.fonts.ready
    })
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>('[data-capture-state]')?.dataset.captureState ===
        'ready'
    )
    const recording = await page
      .locator('[data-capture-state]')
      .evaluate((element: HTMLElement) => ({
        recordingId: element.dataset.recordingId,
        title: element.dataset.recordingTitle,
        durationMs: Number(element.dataset.durationMs),
      }))
    if (!recording.recordingId || !recording.title || !Number.isFinite(recording.durationMs)) {
      throw new Error('Replay capture metadata is missing or invalid.')
    }
    await page.waitForTimeout(500)
    const session = await context.newCDPSession(page)
    const snapshots: { file: string; at: number }[] = []
    async function captureFrame(at: number) {
      const { data } = await session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
        optimizeForSpeed: true,
        clip: { x: 0, y: 0, ...size, scale },
      })
      const file = `frame-${snapshots.length}.png`
      await writeFile(join(temporary, file), Buffer.from(data, 'base64'))
      snapshots.push({ file, at })
    }
    await captureFrame(0)
    const playbackStarted = performance.now()
    await page.evaluate(() => window.dispatchEvent(new Event('jetty:capture-play')))
    console.log(
      `Recording ${recording.title} at 1× (${size.width * scale}×${size.height * scale}, ${fps} fps)…`
    )
    let stopAt = Infinity
    let failure: unknown
    const complete = page
      .waitForFunction(
        () =>
          document.querySelector<HTMLElement>('[data-capture-state]')?.dataset.captureState ===
          'complete',
        undefined,
        {
          timeout: Math.max(60_000, recording.durationMs + 60_000),
        }
      )
      .then(
        () => {
          stopAt = performance.now() + 1000
        },
        (error: unknown) => {
          failure = error
          stopAt = 0
        }
      )
    while (performance.now() < stopAt) {
      const frameStarted = performance.now()
      await captureFrame(0.25 + (frameStarted - playbackStarted) / 1000)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, frameStarted + 1000 / fps - performance.now()))
      )
    }
    await complete
    if (failure) throw failure
    const duration = 0.25 + (performance.now() - playbackStarted) / 1000
    await context.close()
    console.log(`Encoding ${snapshots.length} snapshots as lossless VP9…`)
    const concat =
      snapshots
        .map((frame, index) => {
          const end = snapshots[index + 1]?.at ?? duration
          return `file '${frame.file}'\noption framerate 1000\nduration ${end - frame.at}\n`
        })
        .join('') + `file '${snapshots[snapshots.length - 1]!.file}'\noption framerate 1000\n`
    const input = join(temporary, 'frames.txt')
    await writeFile(input, concat)
    const output = join(temporary, 'preview.webm')
    await command([
      values.ffmpeg,
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      input,
      '-t',
      String(duration),
      '-an',
      '-vf',
      `fps=${fps},setpts=PTS-STARTPTS`,
      '-c:v',
      'libvpx-vp9',
      '-lossless',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-cpu-used',
      '4',
      '-row-mt',
      '1',
      '-b:v',
      '0',
      '-g',
      String(fps),
      '-fps_mode',
      'cfr',
      '-cues_to_front',
      '1',
      '-y',
      output,
    ])
    const probe = JSON.parse(
      await command([
        values.ffprobe,
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-count_frames',
        '-show_streams',
        '-show_format',
        '-show_frames',
        '-show_entries',
        'stream=codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration:frame=key_frame,best_effort_timestamp_time',
        '-of',
        'json',
        output,
      ])
    )
    const stream = probe.streams[0]
    const frames = probe.frames as { key_frame: number; best_effort_timestamp_time: string }[]
    const frameCount = Number(stream.nb_read_frames)
    if (
      stream.codec_name !== 'vp9' ||
      stream.width !== size.width * scale ||
      stream.height !== size.height * scale ||
      stream.avg_frame_rate !== '25/1' ||
      frameCount !== frames.length ||
      frames[0]?.key_frame !== 1
    ) {
      throw new Error(
        'Encoded video failed codec, dimensions, frame rate, frame count or initial keyframe validation.'
      )
    }
    let lastKeyframe = 0
    for (const [index, frame] of frames.entries()) {
      if (Math.abs(Number(frame.best_effort_timestamp_time) - index / fps) > 0.002) {
        throw new Error('Encoded video is not constant frame rate.')
      }
      if (frame.key_frame) lastKeyframe = index
      if (index - lastKeyframe >= fps)
        throw new Error('Encoded video keyframe gap exceeds one second.')
    }
    const manifest = {
      version: 1,
      recordingId: recording.recordingId,
      title: recording.title,
      src: '/streaming-replay.local/preview.webm',
      fps,
      frameCount,
      duration: Number(probe.format.duration),
      width: stream.width,
      height: stream.height,
      capturedAt: new Date().toISOString(),
      sourceRevision,
    }
    const destination = join(root, 'client/streaming-replay.local')
    await mkdir(destination, { recursive: true })
    await writeFile(join(temporary, 'preview.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await rename(output, join(destination, 'preview.webm'))
    await rename(join(temporary, 'preview.json'), join(destination, 'preview.json'))
    console.log(
      `Saved ${frameCount} frames from ${snapshots.length} snapshots, ${manifest.duration}s, ${manifest.width}×${manifest.height}: ${destination}/preview.webm`
    )
  } finally {
    await browser?.close()
    await rm(temporary, { recursive: true, force: true })
  }
}

await main()
