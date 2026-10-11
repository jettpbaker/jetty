import { mkdtemp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string' },
    ffmpeg: { type: 'string', default: process.env.FFMPEG ?? 'ffmpeg' },
    help: { type: 'boolean' },
  },
})

async function main() {
  if (values.help) {
    console.log('bun run replay:frame FRAME [--output FILE.png] [--ffmpeg BIN] (zero-based)')
    return
  }
  const frame = Number(positionals[0])
  if (positionals.length !== 1 || !/^\d+$/.test(positionals[0]!) || !Number.isSafeInteger(frame)) {
    throw new Error('Supply one non-negative integer frame number, e.g. bun run replay:frame 123.')
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const directory = join(root, 'client/streaming-replay.local')
  const preview = JSON.parse(await readFile(join(directory, 'preview.json'), 'utf8'))
  if (!Number.isSafeInteger(preview.frameCount) || frame >= preview.frameCount) {
    throw new Error(`Frame must be between 0 and ${preview.frameCount - 1}.`)
  }
  const capture = new Date(preview.capturedAt).toISOString().replaceAll(':', '-')
  const output = values.output
    ? resolve(values.output)
    : join(directory, 'frames', capture, `frame-${String(frame).padStart(6, '0')}.png`)
  const temporary = await mkdtemp(join(tmpdir(), 'jetty-preview-frame-'))
  try {
    const image = join(temporary, 'frame.png')
    const encoder = Bun.spawn(
      [
        values.ffmpeg,
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        join(directory, 'preview.webm'),
        '-vf',
        `select=eq(n\\,${frame})`,
        '-frames:v',
        '1',
        image,
      ],
      { stdout: 'ignore', stderr: 'pipe' }
    )
    const [stderr, code] = await Promise.all([new Response(encoder.stderr).text(), encoder.exited])
    if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr}`)
    await mkdir(dirname(output), { recursive: true })
    await rename(image, output)
    console.log(
      `Frame ${frame} · ${preview.recordingId} · captured ${preview.capturedAt}\n${output}`
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

await main()
