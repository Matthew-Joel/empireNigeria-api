/* A single worker runs at 00:00, 06:00, 12:00, 18:00 UTC, without overlap. */
const { spawn } = require('node:child_process')
const { resolve } = require('node:path')
const interval = 6 * 60 * 60 * 1000

function nextCleanupAt(now = Date.now()) {
  return new Date((Math.floor(now / interval) + 1) * interval)
}

function startWorker() {
  let timer
  let child
  let stopping = false

  function schedule() {
    if (stopping) return
    const next = nextCleanupAt()
    console.log(`Upload cleanup scheduled for ${next.toISOString()}`)
    timer = setTimeout(run, next.getTime() - Date.now())
  }

  function run() {
    if (stopping) return
    child = spawn(process.execPath, [resolve(__dirname, '../../scripts/cleanup-expired-uploads.cjs')], { stdio: 'inherit', env: process.env })
    let finished = false
    const watchdog = setTimeout(() => {
      console.error('Upload cleanup exceeded 30 minutes; terminating this run for retry at the next scheduled boundary.')
      child?.kill('SIGTERM')
    }, 30 * 60 * 1000)
    function finish(code) {
      if (finished) return
      finished = true
      clearTimeout(watchdog)
      child = undefined
      if (stopping) { process.exitCode = 0; return }
      if (code !== 0) console.error('Upload cleanup run failed; inspect the structured summary. It will retry at the next scheduled boundary.')
      schedule()
    }
    child.on('error', () => finish(1))
    child.on('close', (code) => finish(code))
  }

  function stop() {
    stopping = true
    clearTimeout(timer)
    if (child) child.kill('SIGTERM')
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  schedule()
}

if (require.main === module) startWorker()
module.exports = { nextCleanupAt }
