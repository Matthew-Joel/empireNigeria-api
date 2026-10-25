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

async function main() {
  // Match the bounded hosted-connection settings used by reporting smoke tests.
  const connection = new URL(process.env.DATABASE_URL)
  for (const [key, value] of [['connect_timeout', '15'], ['pool_timeout', '15'], ['socket_timeout', '30']]) connection.searchParams.set(key, value)
  process.env.DATABASE_URL = connection.toString()
  const app = await NestFactory.create(AppModule, { logger: ['error'] })
  const prisma = app.get(PrismaService)
  const storage = app.get(SupabaseStorageService)
  const jwt = app.get(JwtService)
  const run = randomUUID().slice(0, 12)
  const userIds = []
  const keys = new Set()
  let propertyId
  configureApp(app)
  try {
    const users = {}
    for (const role of ['OWNER', 'ADMIN', 'PROPERTY_MANAGER']) {
      const user = await prisma.user.create({ data: { email: `property-smoke-${run}-${role.toLowerCase()}@example.invalid`, passwordHash: 'unused-test-fixture', role, status: 'ACTIVE', emailVerifiedAt: new Date() } })
      userIds.push(user.id)
      users[role] = { ...user, token: jwt.sign({ sub: user.id, email: user.email, role, version: 0 }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' }) }
    }
    await app.listen(0, '127.0.0.1')
    const base = `${await app.getUrl()}/api/v1/properties`
    async function request(path, method, user, body) {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${user.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
      return { status: response.status, body: await response.json().catch(() => null) }
    }
    const draft = { name: 'Smoke test home', type: 'Apartment', description: 'Temporary property for API verification.', address: '1 Test Street', city: 'Lagos', state: 'Lagos', country: 'Nigeria', occupancyStatus: 'VACANT' }
    const created = await request('', 'POST', users.OWNER, draft)
    assert.equal(created.status, 201)
    propertyId = created.body.id
    assert.equal(created.body.ownerId, users.OWNER.id)
    assert.equal(created.body.status, 'DRAFT', 'Property stays private until its proof is uploaded and submitted')
    assert.equal((await request('', 'GET', users.OWNER)).body.some((item) => item.id === propertyId), true)
    const inaccessible = await request(`/${propertyId}`, 'GET', users.PROPERTY_MANAGER)
    assert.equal(inaccessible.status, 404)
    assert.equal((await request(`/${propertyId}/review`, 'PATCH', users.ADMIN, { status: 'APPROVED' })).status, 400, 'Admin cannot approve an unfinished property')
    assert.equal((await request(`/${propertyId}/submit`, 'POST', users.OWNER)).status, 400, 'Ownership proof is required')
    const proofId = await submitPropertyWithOwnership({ request: (path, ...args) => request(path.slice('/properties'.length), ...args), prisma, propertyId, owner: users.OWNER, keys })
    assert.equal((await prisma.propertyFile.findUnique({ where: { id: proofId } })).ownershipDocumentType, 'CERTIFICATE_OF_OCCUPANCY', 'Ownership category is stored with the completed file')
    const signed = await request(`/${propertyId}/files/${proofId}/url?download=false`, 'GET', users.OWNER)
    assert.equal(signed.status, 200, 'Owner can request a private ownership document URL')
    assert.equal((await fetch(signed.body.url, { signal: AbortSignal.timeout(15_000) })).status, 200, 'Signed ownership document is readable')
    const publicUrl = new URL(signed.body.url)
    publicUrl.pathname = publicUrl.pathname.replace('/object/sign/', '/object/public/')
    publicUrl.search = ''
    assert.equal((await fetch(publicUrl, { signal: AbortSignal.timeout(15_000) })).ok, false, 'Ownership evidence cannot be read through a public Storage URL')
    const review = await request(`/${propertyId}/review`, 'PATCH', users.ADMIN, { status: 'UNDER_REVIEW', reviewNote: 'Ready for manager review' })
    assert.equal(review.status, 200)
    assert.equal((await request(`/${propertyId}/submit`, 'POST', users.OWNER)).body.status, 'UNDER_REVIEW', 'A repeated submission must preserve review progress')
    assert.equal(await prisma.auditEvent.count({ where: { entityId: propertyId, action: 'PROPERTY_SUBMITTED' } }), 1, 'Submission retry must not duplicate the audit event')
    assert.equal((await request(`/${propertyId}/files/${proofId}`, 'DELETE', users.OWNER)).status, 400, 'The last submitted ownership proof cannot be removed')
    const overviewUrl = `${await app.getUrl()}/api/v1/admin/overview`
    const ownerOverview = await fetch(overviewUrl, { headers: { Authorization: `Bearer ${users.OWNER.token}` }, signal: AbortSignal.timeout(30_000) })
    assert.equal(ownerOverview.status, 403, 'Owner cannot access administrator overview')
    const adminOverview = await fetch(overviewUrl, { headers: { Authorization: `Bearer ${users.ADMIN.token}` }, signal: AbortSignal.timeout(30_000) })
    assert.equal(adminOverview.status, 200, 'Administrator can access overview')
    const overview = await adminOverview.json()
    assert.ok(overview.totalProperties >= 1 && overview.reviewQueue >= 1, 'Overview should count real properties')
    const assigned = await request(`/${propertyId}/manager`, 'PATCH', users.ADMIN, { managerId: users.PROPERTY_MANAGER.id })
    assert.equal(assigned.status, 200)
    assert.equal((await request(`/${propertyId}`, 'GET', users.PROPERTY_MANAGER)).status, 200)
    assert.equal((await request(`/${propertyId}`, 'PATCH', users.PROPERTY_MANAGER, draft)).status, 403)
    const approved = await request(`/${propertyId}/review`, 'PATCH', users.ADMIN, { status: 'APPROVED' })
    assert.equal(approved.status, 200)
    assert.equal((await request(`/${propertyId}`, 'PATCH', users.OWNER, draft)).status, 403)
    console.log('PASS required ownership upload, draft submission, category persistence, review-safe retries, last-proof protection, owner scope, admin overview, manager assignment, and edit permissions. Temporary fixtures will be removed.')
  } finally {
    const cleanupErrors = []
    try {
      for (const key of keys) await storage.remove(key).catch(() => cleanupErrors.push(key))
      if (userIds.length) await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })
      if (propertyId) await prisma.property.deleteMany({ where: { id: propertyId } })
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } })
      if (propertyId) assert.equal(await prisma.property.count({ where: { id: propertyId } }), 0, 'Temporary property was removed')
      if (userIds.length) assert.equal(await prisma.user.count({ where: { id: { in: userIds } } }), 0, 'Temporary test accounts were removed')
    } finally {
      await app.close()
    }
    if (cleanupErrors.length) throw new Error(`Could not remove ${cleanupErrors.length} Storage fixture(s) from run ${run}`)
    console.log('PASS temporary property/account cleanup and tracked Storage removals.')
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Property smoke test failed'); process.exitCode = 1 })
