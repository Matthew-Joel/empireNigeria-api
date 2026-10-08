/* Run existing live checks sequentially. Each check owns and cleans its fixtures. */
const { spawn } = require('node:child_process')
const { createScannerFixture } = require('./test-support/scanner-daemon.cjs')

async function run(script, args, env) {
  console.log(`START ${script}`)
  const child = spawn(process.execPath, ['--env-file=.env', `scripts/${script}`, ...args], { cwd: process.cwd(), env, stdio: 'inherit' })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (exitCode, signal) => signal ? reject(new Error(`${script} stopped by ${signal}`)) : resolve(exitCode)) })
  if (code !== 0) throw new Error(`${script} failed with exit code ${code}`)
  console.log(`DONE ${script}`)
}

async function main() {
  const email = process.argv.find((arg) => arg.startsWith('--email='))?.slice(8)
  const captureEmail = process.argv.includes('--email-fixture')
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',')
  const useFixture = process.argv.includes('--scanner-protocol-fixture')
  const checks = [
    ['property', 'property-smoke.cjs', []],
    ['storage', 'storage-smoke.cjs', useFixture ? ['--scanner-integration'] : []],
    ['inspection', 'inspection-smoke.cjs', []],
    ['maintenance', 'maintenance-smoke.cjs', []],
    ['stay', 'stay-operations-smoke.cjs', []],
    ['cleanup', 'cleanup-smoke.cjs', []],
    ...(email || captureEmail ? [['auth', 'auth-smoke.cjs', captureEmail ? ['--email-fixture'] : [`--email=${email}`]]] : []),
  ]
  if (only?.some((name) => !checks.some(([key]) => key === name))) throw new Error('Unknown check, or auth selected without --email-fixture or an approved --email mailbox')
  const scanner = useFixture ? await createScannerFixture() : null
  const env = { ...process.env, ...(scanner ? { FILE_SCAN_REQUIRED: 'true', CLAMAV_HOST: scanner.host, CLAMAV_PORT: scanner.port } : {}) }
  if (scanner) console.log('Scanner checks use a controlled protocol fixture; real ClamAV engine deployment is a separate operational check.')
  try {
    for (const [name, script, args] of checks) if (!only || only.includes(name)) await run(script, args, env)
    console.log(`PASS all selected technical acceptance checks${scanner ? `; controlled scanner received ${scanner.scans} upload streams` : ''}.`)
  } finally { if (scanner) await scanner.close() }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
