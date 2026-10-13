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
  const started = Date.now()
  const code = await child.exited
  if (stopping) process.exit(code)
  if (restart) continue
  // A crash after a good run is restarted, as a supervisor would. One straight after starting
  // would only crash again, so that exits.
  if (Date.now() - started < 30_000) process.exit(code)
  console.error(`=== jetty exited (${code}), restarting in 2s`)
  await Bun.sleep(2000)
}
