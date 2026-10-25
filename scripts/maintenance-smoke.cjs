/* Live maintenance workflow smoke test. Run-scoped PostgreSQL and Storage fixtures are removed. */
require('reflect-metadata')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { NestFactory } = require('@nestjs/core')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../dist/app.module')
const { PrismaService } = require('../dist/database/prisma.service')
const { SupabaseStorageService } = require('../dist/modules/storage/supabase-storage.service')
const { configureApp } = require('../dist/app.setup')
const { submitPropertyWithOwnership } = require('./test-support/submit-property-with-ownership.cjs')

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64')

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] })
  configureApp(app)
  const prisma = app.get(PrismaService)
  const storage = app.get(SupabaseStorageService)
  const jwt = app.get(JwtService)
  const run = randomUUID().slice(0, 12)
  const userIds = []
  const keys = new Set()
  let propertyId
  try {
    const users = {}
    for (const label of ['OWNER', 'PROPERTY_MANAGER', 'CONTRACTOR', 'ADMIN', 'OTHER']) {
      const role = label === 'OTHER' ? 'OWNER' : label
      const user = await prisma.user.create({ data: { email: `maintenance-smoke-${run}-${label.toLowerCase()}@example.invalid`, passwordHash: 'unused-test-fixture', role, status: 'ACTIVE', emailVerifiedAt: new Date() } })
      userIds.push(user.id)
      users[label] = { ...user, token: jwt.sign({ sub: user.id, email: user.email, role, version: 0 }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '10m' }) }
    }
    await app.listen(0, '127.0.0.1')
    const base = `${await app.getUrl()}/api/v1`
    async function request(path, method, user, body) {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${user.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
      return { status: response.status, body: await response.json().catch(() => null) }
    }
    async function upload(path, user, kind, name) {
      const started = await request(`${path}/evidence`, 'POST', user, { type: 'PHOTO', kind, fileName: name, caption: `${kind} photo`, contentType: 'image/png', sizeBytes: png.length })
      assert.equal(started.status, 201, `Start ${kind} upload: ${JSON.stringify(started.body)}`)
      const evidence = await prisma.maintenanceEvidence.findUnique({ where: { id: started.body.id } })
      keys.add(evidence.objectKey)
      keys.add(`maintenance/${path.split('/').at(-1)}/${evidence.id}`)
      const form = new FormData()
      form.append('cacheControl', '60')
      form.append('', new Blob([png], { type: 'image/png' }), name)
      assert.equal((await fetch(started.body.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form, signal: AbortSignal.timeout(30_000) })).ok, true, `Upload ${kind} to Supabase`)
      assert.equal((await request(`${path}/evidence/${evidence.id}/complete`, 'POST', user)).status, 201, `Verify ${kind} upload`)
      return evidence.id
    }
    const created = await request('/properties', 'POST', users.OWNER, { name: 'Temporary maintenance home', type: 'Apartment', description: 'Temporary property for maintenance workflow verification.', address: '1 Test Street', city: 'Lagos', state: 'Lagos', country: 'Nigeria', occupancyStatus: 'VACANT' })
    assert.equal(created.status, 201, 'Create property')
    propertyId = created.body.id
    await submitPropertyWithOwnership({ request, prisma, propertyId, owner: users.OWNER, keys })
    assert.equal((await request(`/properties/${propertyId}/manager`, 'PATCH', users.ADMIN, { managerId: users.PROPERTY_MANAGER.id })).status, 200)
    const reported = await request('/maintenance', 'POST', users.OWNER, { propertyId, issue: 'Kitchen pipe leak', description: 'Water is leaking below the kitchen sink.', priority: 'HIGH' })
    assert.equal(reported.status, 201, `Owner reports issue: ${JSON.stringify(reported.body)}`)
    const path = `/maintenance/${reported.body.id}`
    assert.equal((await request(path, 'GET', users.OTHER)).status, 404, 'Other owner cannot read request')
    assert.equal((await request(path, 'GET', users.PROPERTY_MANAGER)).status, 200, 'Assigned manager can read request')
    assert.equal((await request(path, 'GET', users.CONTRACTOR)).status, 404, 'Unassigned contractor cannot read request')
    assert.equal((await request(`${path}/assign`, 'POST', users.OWNER, { contractorId: users.CONTRACTOR.id, note: 'Please repair the leaking kitchen pipe.' })).status, 403, 'Owner cannot assign contractor')
    const issueEvidenceId = await upload(path, users.OWNER, 'ISSUE', 'leak.png')
    await prisma.user.update({ where: { id: users.CONTRACTOR.id }, data: { status: 'SUSPENDED' } })
    assert.equal((await request(`${path}/assign`, 'POST', users.ADMIN, { contractorId: users.CONTRACTOR.id, note: 'Please repair the leaking kitchen pipe.' })).status, 400, 'Inactive contractor cannot be assigned')
    await prisma.user.update({ where: { id: users.CONTRACTOR.id }, data: { status: 'ACTIVE' } })
    const assigned = await request(`${path}/assign`, 'POST', users.ADMIN, { contractorId: users.CONTRACTOR.id, note: 'Please repair the leaking kitchen pipe.' })
    assert.equal(assigned.status, 201, 'Admin assigns active contractor')
    assert.equal(assigned.body.status, 'ASSIGNED')
    assert.equal((await request(`${path}/progress`, 'POST', users.CONTRACTOR, { note: 'Inspected the leaking pipe.' })).status, 409, 'Cannot post progress before starting')
    assert.equal((await request(`${path}/start`, 'POST', users.CONTRACTOR, { note: 'Started inspecting the kitchen pipe.' })).status, 409, 'Cannot start before owner approves quote')
    const firstQuote = await request(`${path}/quotes`, 'POST', users.CONTRACTOR, { amountNgn: 45000, scope: 'Replace the damaged kitchen pipe and test for leaks.', expectedDurationDays: 2, notes: 'Includes materials and cleanup of the sink area.' })
    assert.equal(firstQuote.status, 201, `Contractor submits quote: ${JSON.stringify(firstQuote.body)}`)
    assert.equal(firstQuote.body.status, 'PENDING_APPROVAL')
    assert.equal((await request(`${path}/quotes/${firstQuote.body.quotes[0].id}/decision`, 'POST', users.OTHER, { decision: 'APPROVE' })).status, 404, 'Other owner cannot approve quote')
    assert.equal((await request(`${path}/quotes/${firstQuote.body.quotes[0].id}/decision`, 'POST', users.OWNER, { decision: 'REJECT', note: 'Please include a warranty for the repaired pipe.' })).status, 201, 'Owner rejects quote with reason')
    const revised = await request(`${path}/quotes`, 'POST', users.CONTRACTOR, { amountNgn: 47000, scope: 'Replace the pipe, test for leaks, and include a warranty.', expectedDurationDays: 2, notes: 'Includes a ninety-day repair warranty and cleanup.' })
    assert.equal(revised.status, 201, 'Contractor submits revised quote')
    assert.equal(revised.body.quotes[0].revision, 2)
    assert.equal((await request(`${path}/quotes/${revised.body.quotes[0].id}/decision`, 'POST', users.OWNER, { decision: 'APPROVE' })).status, 201, 'Owner approves revised quote')
    assert.equal((await request(`${path}/start`, 'POST', users.CONTRACTOR, { note: 'Started inspecting the kitchen pipe.' })).status, 201, 'Contractor starts approved job')
    assert.equal((await request(`${path}/evidence`, 'POST', users.CONTRACTOR, { type: 'PHOTO', kind: 'WORK', fileName: 'large.png', caption: 'Oversized file', contentType: 'image/png', sizeBytes: 5_000_001 })).status, 400, 'Reject evidence over 5 MB')
    assert.equal((await request(`${path}/complete`, 'POST', users.CONTRACTOR, { note: 'The pipe repair is complete.' })).status, 400, 'Completion evidence required')
    await upload(path, users.CONTRACTOR, 'WORK', 'repair.png')
    const completionId = await upload(path, users.CONTRACTOR, 'COMPLETION', 'finished.png')
    assert.equal((await request(`${path}/progress`, 'POST', users.CONTRACTOR, { note: 'Replaced the damaged kitchen pipe.' })).status, 201, 'Contractor posts progress')
    const completed = await request(`${path}/complete`, 'POST', users.CONTRACTOR, { note: 'The pipe is repaired and the area is dry.' })
    assert.equal(completed.status, 201, 'Contractor completes job')
    assert.equal(completed.body.status, 'COMPLETED')
    const managerView = await request(path, 'GET', users.PROPERTY_MANAGER)
    assert.equal(managerView.body.evidence.length, 3, 'Manager sees issue, work, and completion evidence')
    assert.equal(managerView.body.updates.length, 9, 'Manager sees report, assignment, quote decisions, and work progress')
    assert.equal(managerView.body.quotes.length, 2, 'Manager sees both quote revisions')
    const signed = await request(`${path}/evidence/${completionId}/url`, 'GET', users.OWNER)
    assert.equal(signed.status, 200, 'Owner can sign evidence')
    assert.deepEqual(Buffer.from(await (await fetch(signed.body.url, { signal: AbortSignal.timeout(15_000) })).arrayBuffer()), png, 'Signed evidence reads original bytes')
    assert.equal((await request(`${path}/evidence/${issueEvidenceId}/url`, 'GET', users.OTHER)).status, 404, 'Other owner cannot access evidence')
    assert.equal((await request(`${path}/close`, 'POST', users.ADMIN, { note: 'Verified the contractor evidence and closed the request.' })).status, 201, 'Admin closes request')
    assert.equal((await request(path, 'GET', users.OWNER)).body.status, 'CLOSED', 'Owner sees closed outcome')
    const audit = await request('/admin/audit?entityType=MAINTENANCE', 'GET', users.ADMIN)
    assert.equal(audit.status, 200, 'Admin can read the audit log')
    assert.ok(audit.body.items.some((item) => item.entityId === reported.body.id && item.action === 'MAINTENANCE_QUOTE_APPROVED'), 'Quote approval is audited')
    assert.equal((await request('/admin/audit', 'GET', users.OWNER)).status, 403, 'Owner cannot read platform audit log')
    const analytics = await request('/admin/analytics', 'GET', users.ADMIN)
    assert.equal(analytics.status, 200, 'Admin can read real analytics')
    assert.ok(analytics.body.months.some((month) => month.maintenance >= 1), 'Analytics count maintenance requests')
    console.log('PASS live maintenance quotes, owner approval/rejection, role scope, progress, private Supabase evidence, 5 MB limit, audit log, analytics, and closeout.')
  } finally {
    const cleanupErrors = []
    for (const key of keys) await storage.remove(key).catch(() => cleanupErrors.push(key))
    if (userIds.length) await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })
    if (propertyId) await prisma.property.deleteMany({ where: { id: propertyId } })
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await app.close()
    if (cleanupErrors.length) throw new Error(`Could not remove ${cleanupErrors.length} Storage fixture(s) from run ${run}`)
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Maintenance smoke test failed'); process.exitCode = 1 })
