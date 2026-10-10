/* Run existing live checks sequentially. Each check owns and cleans its fixtures. */
const { spawn } = require('node:child_process')

async function run(script, args) {
  console.log(`START ${script}`)
  const child = spawn(process.execPath, ['--env-file=.env', `scripts/${script}`, ...args], { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (exitCode, signal) => signal ? reject(new Error(`${script} stopped by ${signal}`)) : resolve(exitCode)) })
  if (code !== 0) throw new Error(`${script} failed with exit code ${code}`)
  console.log(`DONE ${script}`)
}

async function main() {
  const email = process.argv.find((arg) => arg.startsWith('--email='))?.slice(8)
  const captureEmail = process.argv.includes('--email-fixture')
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',')
  const checks = [
    ['property', 'property-smoke.cjs', []],
    ['storage', 'storage-smoke.cjs', []],
    ['inspection', 'inspection-smoke.cjs', []],
    ['maintenance', 'maintenance-smoke.cjs', []],
    ['stay', 'stay-operations-smoke.cjs', []],
    ['cleanup', 'cleanup-smoke.cjs', []],
    ...(email || captureEmail ? [['auth', 'auth-smoke.cjs', captureEmail ? ['--email-fixture'] : [`--email=${email}`]]] : []),
  ]
  if (only?.some((name) => !checks.some(([key]) => key === name))) throw new Error('Unknown check, or auth selected without --email-fixture or an approved --email mailbox')
  for (const [name, script, args] of checks) if (!only || only.includes(name)) await run(script, args)
  console.log('PASS all selected technical acceptance checks.')
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
