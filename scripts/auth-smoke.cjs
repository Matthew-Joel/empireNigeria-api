/* Live smoke test: creates only run-scoped fixtures, sends email to the approved
 * mailbox, and removes its fixtures in finally. Never prints secrets or codes.
 * Run after prisma migrate deploy and npm run build:
 * node --env-file=.env scripts/auth-smoke.cjs --email=YOUR_TEST_MAILBOX
 */
require('reflect-metadata')
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { NestFactory } = require('@nestjs/core')
const argon2 = require('argon2')
const { AppModule } = require('../dist/app.module')
const { configureApp } = require('../dist/app.setup')
const { PrismaService } = require('../dist/database/prisma.service')
const { NotificationsService } = require('../dist/modules/notifications/notifications.service')

async function main() {
  const captureEmail = process.argv.includes('--email-fixture')
  const recipient = process.argv.find((arg) => arg.startsWith('--email='))?.slice(8) || (captureEmail ? 'auth-fixture@example.invalid' : undefined)
  assert(recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient), 'Supply an explicitly approved test mailbox using --email=')
  const run = randomUUID()
  const fixtureIds = []
  const messages = []
  const password = randomBytes(24).toString('hex') + 'Aa1!'
  const app = await NestFactory.create(AppModule, { logger: ['error'] })
  const prisma = app.get(PrismaService)
  const notifications = app.get(NotificationsService)
  const sendEmail = notifications.sendEmail.bind(notifications)
  notifications.sendEmail = async (input) => {
    const result = captureEmail ? { sent: true } : await sendEmail({ ...input, to: recipient, subject: '[Integration test] ' + input.subject })
    assert(result.sent, 'The test email must be accepted')
    messages.push(input)
    return result
  }
  configureApp(app)
  if (captureEmail) console.log('Email checks use captured messages; live Resend delivery is not tested.')
  await app.listen(0, '127.0.0.1')
  const base = (await app.getUrl()) + '/api/v1'
  const call = async (path, body, token, method = 'POST') => {
    const response = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    const data = await response.json()
    return { status: response.status, data }
  }
  const latestCode = () => {
    const match = messages.at(-1)?.text.match(/use (\d{6}) to/)
    assert(match, 'Expected a real emailed code')
    return match[1]
  }
  const latestToken = () => {
    const match = messages.at(-1)?.text.match(/token=([^\s]+)/)
    assert(match, 'Expected an emailed invitation link')
    return decodeURIComponent(match[1].replace(/\.$/, ''))
  }
  const expectStatus = (response, expected, label) => assert.equal(response.status, expected, label + ' returned HTTP ' + response.status)
  try {
    const preflight = await fetch(base + '/auth/login', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }, signal: AbortSignal.timeout(30_000) })
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173', 'Frontend origin must be allowed by CORS')
    console.log('PASS browser CORS preflight')
    const admin = await prisma.user.create({ data: {
      email: 'smoke-admin-' + run + '@example.invalid', passwordHash: await argon2.hash(password), role: 'ADMIN', status: 'ACTIVE', emailVerifiedAt: new Date(),
      profile: { create: { firstName: 'Integration', lastName: 'Administrator' } },
    } })
    fixtureIds.push(admin.id)
    const adminLogin = await call('/auth/login', { email: admin.email, password })
    expectStatus(adminLogin, 201, 'Admin login')
    const adminToken = adminLogin.data.accessToken
    for (const role of ['ADMIN', 'PROPERTY_MANAGER', 'INSPECTOR', 'CONTRACTOR']) {
      expectStatus(await call('/auth/register', { firstName: 'Integration', lastName: role, email: 'smoke-' + role.toLowerCase() + '-' + run + '@example.invalid', password, role }), 403, role + ' public registration')
    }
    let ownerSession
    let ownerEmail
    for (const role of ['OWNER', 'GUEST']) {
      const email = 'smoke-' + role.toLowerCase() + '-' + run + '@example.invalid'
      const registered = await call('/auth/register', { firstName: 'Integration', lastName: role, email, password, role })
      expectStatus(registered, 201, role + ' registration')
      fixtureIds.push(registered.data.user.id)
      assert(!registered.data.challenge.deliveryError, 'Registration email failed')
      assert(!registered.data.accessToken, 'Pending accounts must not receive access tokens')
      const verified = await call('/auth/verify', { challengeId: registered.data.challenge.id, code: latestCode() })
      expectStatus(verified, 201, role + ' verification')
      const reused = await call('/auth/verify', { challengeId: registered.data.challenge.id, code: '123456' })
      expectStatus(reused, 401, 'Verification reuse')
      const me = await call('/auth/me', undefined, verified.data.accessToken, 'GET')
      expectStatus(me, 200, role + ' authenticated profile')
      assert.equal(me.data.role, role)
      if (role === 'OWNER') { ownerSession = verified.data; ownerEmail = email }
    }
    console.log('PASS public registration, email verification, and verification reuse')
    expectStatus(await call('/admin/users', undefined, ownerSession.accessToken, 'GET'), 403, 'Owner admin restriction')
    const profile = await call('/auth/me', { firstName: 'Integration', lastName: 'Owner', phone: '+234' + String(Date.now()).slice(-10), country: 'Canada', timezone: 'America/Toronto' }, ownerSession.accessToken, 'PATCH')
    expectStatus(profile, 200, 'Profile update')
    assert.equal(profile.data.profile.timezone, 'America/Toronto')
    const reloaded = await call('/auth/me', undefined, ownerSession.accessToken, 'GET')
    assert.equal(reloaded.data.profile.country, 'Canada')
    console.log('PASS profile persistence and administrator restrictions')

    for (const role of ['PROPERTY_MANAGER', 'INSPECTOR', 'CONTRACTOR']) {
      const email = 'smoke-' + role.toLowerCase() + '-' + run + '@example.invalid'
      const invitation = await call('/admin/invitations', { firstName: 'Integration', lastName: role, email, role, phone: '' }, adminToken)
      expectStatus(invitation, 201, role + ' invitation')
      fixtureIds.push(invitation.data.user.id)
      let token = latestToken()
      if (role === 'INSPECTOR') {
        await prisma.user.update({ where: { id: invitation.data.user.id }, data: { invitationExpiresAt: new Date(Date.now() - 60_000) } })
        expectStatus(await call('/auth/invitations/accept', { token, password }), 401, 'Expired invitation')
        await prisma.user.update({ where: { id: invitation.data.user.id }, data: { invitationExpiresAt: new Date(Date.now() + 86_400_000) } })
      }
      if (role === 'PROPERTY_MANAGER') {
        const previousToken = token
        expectStatus(await call('/admin/invitations/' + invitation.data.user.id + '/resend', {}, adminToken), 201, 'Invitation resend')
        token = latestToken()
        expectStatus(await call('/auth/invitations/accept', { token: previousToken, password }), 401, 'Superseded invitation')
      }
      const accepted = await call('/auth/invitations/accept', { token, password })
      expectStatus(accepted, 201, role + ' invitation acceptance')
      assert.equal(accepted.data.user.role, role)
      if (role === 'CONTRACTOR') {
        await prisma.user.update({ where: { id: invitation.data.user.id }, data: { status: 'SUSPENDED' } })
        expectStatus(await call('/auth/me', undefined, accepted.data.accessToken, 'GET'), 401, 'Suspended account access')
        await prisma.user.update({ where: { id: invitation.data.user.id }, data: { status: 'ACTIVE' } })
      }
      expectStatus(await call('/auth/invitations/accept', { token, password }), 401, 'Invitation reuse')
      expectStatus(await call('/auth/login', { email, password }), 201, role + ' login')
    }
    console.log('PASS internal-role registration restrictions, staff invitations, email, expiry, resend, link reuse, and suspended-account access')
    const revoked = await call('/admin/invitations', { firstName: 'Integration', lastName: 'Revoked', email: 'smoke-revoked-' + run + '@example.invalid', role: 'INSPECTOR' }, adminToken)
    expectStatus(revoked, 201, 'Revocation fixture')
    fixtureIds.push(revoked.data.user.id)
    const revokedToken = latestToken()
    expectStatus(await call('/admin/invitations/' + revoked.data.user.id + '/revoke', {}, adminToken), 201, 'Invitation revocation')
    expectStatus(await call('/auth/invitations/accept', { token: revokedToken, password }), 401, 'Revoked link')

    const requested = await call('/auth/password-reset/request', { email: ownerEmail })
    expectStatus(requested, 201, 'Password reset request')
    const resetVerified = await call('/auth/password-reset/verify', { challengeId: requested.data.id, code: latestCode() })
    expectStatus(resetVerified, 201, 'Reset code verification')
    const resetBody = { challengeId: requested.data.id, resetToken: resetVerified.data.resetToken, password: password + 'new' }
    expectStatus(await call('/auth/password-reset/complete', resetBody), 201, 'Password reset')
    expectStatus(await call('/auth/password-reset/complete', resetBody), 401, 'Reset token reuse')
    expectStatus(await call('/auth/me', undefined, ownerSession.accessToken, 'GET'), 401, 'Old access token after reset')
    expectStatus(await call('/auth/refresh', { refreshToken: ownerSession.refreshToken }), 401, 'Old refresh token after reset')
    expectStatus(await call('/auth/login', { email: ownerEmail, password }), 401, 'Old password after reset')
    const newLogin = await call('/auth/login', { email: ownerEmail, password: password + 'new' })
    expectStatus(newLogin, 201, 'New password login')
    const refreshed = await call('/auth/refresh', { refreshToken: newLogin.data.refreshToken })
    expectStatus(refreshed, 201, 'Session refresh')
    expectStatus(await call('/auth/refresh', { refreshToken: newLogin.data.refreshToken }), 401, 'Old refresh token reuse')
    expectStatus(await call('/auth/logout', {}, refreshed.data.accessToken), 201, 'Logout')
    expectStatus(await call('/auth/me', undefined, refreshed.data.accessToken, 'GET'), 401, 'Access token after logout')
    console.log('PASS revocation, recovery, new-password login, refresh rotation, and session invalidation')
    console.log(captureEmail ? 'Captured ' + messages.length + ' test messages; no live Resend delivery was attempted.' : 'Resend accepted ' + messages.length + ' test emails for the approved mailbox; inbox delivery is not verified by this script.')
  } finally {
    // Exact fixture emails also cover a request that saved a user before failing.
    const where = { OR: [ { id: { in: fixtureIds } }, { email: { endsWith: '-' + run + '@example.invalid' } } ] }
    const fixtures = await prisma.user.findMany({ where, select: { id: true } })
    const ids = fixtures.map((user) => user.id)
    if (ids.length) await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } })
    const deleted = await prisma.user.deleteMany({ where })
    console.log('Cleaned up ' + deleted.count + ' temporary test accounts.')
    await app.close()
  }
}

main().catch((error) => { console.error('Live authentication check failed:', error instanceof Error ? error.message : 'unknown error'); process.exitCode = 1 })
