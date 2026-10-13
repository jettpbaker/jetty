let stopping = false
let restart = false
let child: ReturnType<typeof Bun.spawn>

function stop(signal: 'SIGINT' | 'SIGTERM') {
  stopping = true
  child.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

while (true) {
  restart = false
  child = Bun.spawn([process.execPath, 'run', `${import.meta.dir}/main.ts`], {
    env: { ...process.env, JETTY_SUPERVISED: '1' },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    ipc(message) {
      if (message === 'restart') restart = true
    },
  })
  const code = await child.exited
  if (stopping || !restart) process.exit(code)
}
