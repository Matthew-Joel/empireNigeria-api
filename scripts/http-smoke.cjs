require('reflect-metadata')
const assert = require('node:assert/strict')
const { NestFactory } = require('@nestjs/core')
const { AppModule } = require('../dist/app.module')
const { configureApp } = require('../dist/app.setup')

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] })
  configureApp(app)
  try {
    await app.listen(0, '127.0.0.1')
    const url = (await app.getUrl()) + '/api/v1'
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      const response = await fetch(url + '/auth/login', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })
      assert.equal(response.headers.get('access-control-allow-origin'), origin)
    }
    const untrusted = await fetch(url + '/auth/login', { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'POST' } })
    assert.equal(untrusted.headers.get('access-control-allow-origin'), null)
    assert.equal((await fetch(url + '/auth/me')).status, 401)
    const malformed = await fetch(url + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'ADMIN' }) })
    assert.equal(malformed.status, 400)
    console.log('PASS API bootstrap, local browser CORS, disallowed origin, unauthenticated access, and request validation. No users or emails were created.')
  } finally { await app.close() }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'HTTP check failed'); process.exitCode = 1 })
