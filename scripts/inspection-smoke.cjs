/* Live inspection workflow smoke test. Temporary database and Storage fixtures are removed. */
require('reflect-metadata')
// Fixture runs must not email real admins through the workflow notifier.
process.env.WORKFLOW_EMAILS_DISABLED = 'true'
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
    await prisma.$queryRawUnsafe('SELECT 1')
    const users = {}
    for (const label of ['OWNER', 'PROPERTY_MANAGER', 'INSPECTOR', 'ADMIN', 'OTHER']) {
      const role = label === 'OTHER' ? 'OWNER' : label
      const user = await prisma.user.create({ data: { email: `inspection-smoke-${run}-${label.toLowerCase()}@example.invalid`, passwordHash: 'unused-test-fixture', role, status: 'ACTIVE', emailVerifiedAt: new Date() } })
      userIds.push(user.id)
      users[label] = { ...user, token: jwt.sign({ sub: user.id, email: user.email, role, version: 0 }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '10m' }) }
    }
    await app.listen(0, '127.0.0.1')
    const base = `${await app.getUrl()}/api/v1`
    async function request(path, method, user, body) {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${user.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
      return { status: response.status, body: await response.json().catch(() => null) }
    }
    const draft = { name: 'Temporary inspection home', type: 'Apartment', description: 'Run-scoped inspection verification property.', address: '1 Test Street', city: 'Lagos', state: 'Lagos', country: 'Nigeria', occupancyStatus: 'VACANT' }
    const created = await request('/properties', 'POST', users.OWNER, draft)
    assert.equal(created.status, 201, 'Create property')
    propertyId = created.body.id
    await submitPropertyWithOwnership({ request, prisma, propertyId, owner: users.OWNER, keys })
    assert.equal((await request(`/properties/${propertyId}/review`, 'PATCH', users.ADMIN, { status: 'UNDER_REVIEW', reviewNote: 'Inspection smoke' })).status, 200)
    assert.equal((await request(`/properties/${propertyId}/review`, 'PATCH', users.ADMIN, { status: 'APPROVED' })).status, 200)
    assert.equal((await request(`/properties/${propertyId}/manager`, 'PATCH', users.ADMIN, { managerId: users.PROPERTY_MANAGER.id })).status, 200)
    const scheduleInput = { propertyId, inspectorId: users.INSPECTOR.id, purpose: 'Routine inspection', summary: 'Check condition of the temporary property.', scheduledAt: new Date(Date.now() + 86400000).toISOString() }
    await prisma.user.update({ where: { id: users.INSPECTOR.id }, data: { status: 'SUSPENDED' } })
    assert.equal((await request('/inspections', 'POST', users.ADMIN, scheduleInput)).status, 400, 'Inactive inspector cannot be assigned')
    await prisma.user.update({ where: { id: users.INSPECTOR.id }, data: { status: 'ACTIVE' } })
    const scheduled = await request('/inspections', 'POST', users.ADMIN, scheduleInput)
    assert.equal(scheduled.status, 201, `Schedule: ${JSON.stringify(scheduled.body)}`)
    const path = `/inspections/${scheduled.body.id}`
    assert.equal((await request(path, 'GET', users.OTHER)).status, 404, 'Other owner cannot see inspection')
    assert.equal((await request(path, 'GET', users.PROPERTY_MANAGER)).status, 200, 'Assigned manager can see inspection')
    assert.equal((await request('/inspections', 'POST', users.OWNER, { propertyId })).status, 403, 'Owner cannot schedule')
    assert.equal((await request(path, 'GET', users.OWNER)).body.report, null, 'Owner report hidden before submission')
    assert.equal((await request(`${path}/start`, 'POST', users.INSPECTOR)).status, 201, 'Inspector starts')
    assert.equal((await request(`${path}/evidence`, 'POST', users.INSPECTOR, { type: 'PHOTO', fileName: 'oversize.png', caption: 'Oversize', contentType: 'image/png', sizeBytes: 5_000_001 })).status, 400, '5 MB limit')
    const started = await request(`${path}/evidence`, 'POST', users.INSPECTOR, { type: 'PHOTO', fileName: 'front.png', caption: 'Front view', contentType: 'image/png', sizeBytes: png.length })
    assert.equal(started.status, 201, 'Sign evidence upload')
    const evidence = await prisma.inspectionEvidence.findUnique({ where: { id: started.body.id } })
    keys.add(evidence.objectKey)
    keys.add(`inspections/${scheduled.body.id}/${evidence.id}`)
    const form = new FormData()
    form.append('cacheControl', '60')
    form.append('', new Blob([png], { type: 'image/png' }), 'front.png')
    assert.equal((await fetch(started.body.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form, signal: AbortSignal.timeout(30_000) })).ok, true, 'Upload to Supabase')
    assert.equal((await request(`${path}/evidence/${evidence.id}/complete`, 'POST', users.INSPECTOR)).status, 201, 'Verify evidence')
    assert.equal((await request(`${path}/evidence/${evidence.id}/url`, 'GET', users.OWNER)).status, 404, 'Owner evidence hidden before report')
    assert.equal((await request(`${path}/complete`, 'POST', users.INSPECTOR)).status, 201, 'Complete visit')
    const report = await request(`${path}/report`, 'POST', users.INSPECTOR, { overview: 'The temporary property is in good condition.', recommendations: ['Keep the entryway clear'], findings: [{ area: 'Entrance', title: 'Entry condition', severity: 'LOW', detail: 'The entryway is clean and dry.', recommendation: 'Continue routine cleaning.' }] })
    assert.equal(report.status, 201, `Submit report: ${JSON.stringify(report.body)}`)
    assert.equal(report.body.status, 'REPORT_READY')
    assert.equal((await request(path, 'GET', users.OWNER)).body.findings.length, 1, 'Owner can see submitted finding')
    assert.equal((await request(path, 'GET', users.PROPERTY_MANAGER)).body.evidence.length, 1, 'Manager can see submitted evidence')
    const signed = await request(`${path}/evidence/${evidence.id}/url`, 'GET', users.OWNER)
    assert.equal(signed.status, 200, 'Owner can sign evidence after report')
    assert.deepEqual(Buffer.from(await (await fetch(signed.body.url, { signal: AbortSignal.timeout(15_000) })).arrayBuffer()), png, 'Signed evidence reads original bytes')
    console.log('PASS live inspection scheduling, role scope, visit transitions, Supabase evidence, 5 MB limit, report visibility, and signed reads. Temporary fixtures removed.')
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

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Inspection smoke test failed'); process.exitCode = 1 })
