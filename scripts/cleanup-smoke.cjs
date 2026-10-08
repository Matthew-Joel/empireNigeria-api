/* Live cleanup acceptance uses only IDs/keys created by this run; no email is sent. */
require('reflect-metadata')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PrismaClient } = require('@prisma/client')
const { ConfigService } = require('@nestjs/config')
const { SupabaseStorageService } = require('../dist/modules/storage/supabase-storage.service')
const { cleanupExpiredUploads, parseCleanupOptions } = require('./lib/expired-upload-cleanup.cjs')

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64')

async function main() {
  const prisma = new PrismaClient()
  const storage = new SupabaseStorageService(new ConfigService(process.env))
  const run = randomUUID()
  const prefix = `pending/cleanup-smoke-${run}/`
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const users = []
  const fixtures = []
  let propertyId
  let testError

  async function putObject(key, bucket) {
    const uploadUrl = await storage.signUpload(key, bucket)
    const form = new FormData()
    form.append('', new Blob([png], { type: 'image/png' }), 'fixture.png')
    const response = await fetch(uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form, signal: AbortSignal.timeout(30_000) })
    assert.ok(response.ok, `Fixture upload returned HTTP ${response.status}`)
  }

  async function objectExists(key, bucket) {
    const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    const base = process.env.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/'
    const path = [bucket, ...key.split('/')].map(encodeURIComponent).join('/')
    const response = await fetch(base + path, { headers: { apikey: secret, ...(process.env.SUPABASE_SECRET_KEY ? {} : { Authorization: `Bearer ${secret}` }) }, signal: AbortSignal.timeout(30_000) })
    if (response.ok) { assert.deepEqual(Buffer.from(await response.arrayBuffer()), png); return true }
    const body = await response.json().catch(() => ({}))
    assert.ok(response.status === 404 || ((response.status === 400 || response.status === 404) && (String(body.statusCode) === '404' || /not found/i.test(String(body.message || body.error || '')))), `Object check failed unexpectedly: HTTP ${response.status}`)
    return false
  }

  async function fixture(delegate, data, bucket, removed) {
    const row = await prisma[delegate].create({ data: { contentType: 'image/png', sizeBytes: png.length, createdAt: old, ...data } })
    fixtures.push({ delegate, id: row.id, key: row.objectKey, bucket, removed })
    await putObject(row.objectKey, bucket)
    return row
  }

  try {
    for (const role of ['OWNER', 'INSPECTOR']) {
      const user = await prisma.user.create({ data: { email: `cleanup-smoke-${run}-${role.toLowerCase()}@example.invalid`, passwordHash: 'unused-test-fixture', role, status: 'ACTIVE', profile: { create: { firstName: 'Cleanup', lastName: 'Fixture' } } } })
      users.push(user)
    }
    const ownerId = users[0].id
    const property = await prisma.property.create({ data: { ownerId, name: 'Temporary cleanup acceptance', type: 'Apartment', description: 'Run-scoped cleanup fixture', address: '1 Integration Street', city: 'Lagos', state: 'Lagos' } })
    propertyId = property.id
    const inspection = await prisma.inspection.create({ data: { propertyId, inspectorId: users[1].id, purpose: 'Cleanup fixture', summary: 'Run-scoped evidence', scheduledAt: new Date() } })
    const maintenance = await prisma.maintenanceRequest.create({ data: { propertyId, issue: 'Cleanup fixture', description: 'Run-scoped evidence' } })
    const propertyBase = { propertyId, uploaderId: ownerId, purpose: 'PHOTO', originalName: 'fixture.png' }
    for (let index = 0; index < 3; index += 1) await fixture('propertyFile', { ...propertyBase, objectKey: `${prefix}property-${index}.png` }, storage.propertyBucket, true)
    await fixture('inspectionEvidence', { inspectionId: inspection.id, uploaderId: users[1].id, type: 'PHOTO', originalName: 'fixture.png', caption: 'Cleanup fixture', objectKey: `${prefix}inspection.png` }, storage.propertyBucket, true)
    await fixture('maintenanceEvidence', { requestId: maintenance.id, uploaderId: ownerId, type: 'PHOTO', kind: 'ISSUE', originalName: 'fixture.png', caption: 'Cleanup fixture', objectKey: `${prefix}maintenance.png` }, storage.propertyBucket, true)
    await fixture('profileImageUpload', { userId: ownerId, objectKey: `${prefix}profile.png` }, storage.profileBucket, true)
    await fixture('propertyFile', { ...propertyBase, objectKey: `${prefix}ready-status.png`, status: 'READY', completedAt: old }, storage.propertyBucket, false)
    await fixture('propertyFile', { ...propertyBase, objectKey: `${prefix}recent.png`, createdAt: new Date() }, storage.propertyBucket, false)
    await fixture('propertyFile', { ...propertyBase, objectKey: `pending/cleanup-sentinel-${run}/outside.png` }, storage.propertyBucket, false)
    await fixture('propertyFile', { ...propertyBase, objectKey: `properties/${propertyId}/${randomUUID()}`, status: 'READY', completedAt: old }, storage.propertyBucket, false)
    const finalizedAvatar = await fixture('profileImageUpload', { userId: ownerId, objectKey: `profiles/${ownerId}/${randomUUID()}` }, storage.profileBucket, false)
    await prisma.userProfile.update({ where: { userId: ownerId }, data: { avatarObjectKey: finalizedAvatar.objectKey } })

    const boundedArgs = ['--prefix', prefix, '--batch-size', '2', '--max-batches', '3']
    const dry = await cleanupExpiredUploads({ prisma, storage, options: parseCleanupOptions(['--dry-run', ...boundedArgs]) })
    assert.equal(dry.totals.wouldRemove, 6)
    assert.equal(dry.totals.removed, 0)
    assert.equal(dry.totals.failed, 0)
    for (const row of fixtures) {
      assert.ok(await prisma[row.delegate].findUnique({ where: { id: row.id } }), 'Dry run preserves metadata')
      assert.equal(await objectExists(row.key, row.bucket), true, 'Dry run preserves bytes')
    }
    console.log('PASS scoped cleanup dry run preserves every fixture record and object')

    const cleaned = await cleanupExpiredUploads({ prisma, storage, options: parseCleanupOptions(boundedArgs) })
    assert.equal(cleaned.totals.removed, 6)
    assert.equal(cleaned.totals.failed, 0)
    assert.equal(cleaned.kinds.find((kind) => kind.kind === 'propertyFiles').batches, 2, 'All property fixtures span bounded batches')
    for (const row of fixtures) {
      assert.equal(Boolean(await prisma[row.delegate].findUnique({ where: { id: row.id } })), !row.removed, 'Cleanup preserves READY/recent/outside-prefix metadata')
      assert.equal(await objectExists(row.key, row.bucket), !row.removed, 'Cleanup preserves READY/recent/outside-prefix bytes')
    }
    assert.equal((await prisma.userProfile.findUnique({ where: { userId: ownerId } })).avatarObjectKey, finalizedAvatar.objectKey, 'Finalized profile avatar stays attached')
    const repeated = await cleanupExpiredUploads({ prisma, storage, options: parseCleanupOptions(boundedArgs) })
    assert.equal(repeated.totals.candidates, 0, 'Repeating scoped cleanup is idempotent')
    console.log('PASS expired property/inspection/maintenance/profile cleanup, bounded batches, READY/recent/scope preservation, and idempotence')
  } catch (error) {
    testError = error
  } finally {
    const failures = []
    for (const row of fixtures) {
      try { await storage.remove(row.key, row.bucket) } catch { failures.push('fixture-object') }
    }
    try { await prisma.profileImageUpload.deleteMany({ where: { id: { in: fixtures.filter((row) => row.delegate === 'profileImageUpload').map((row) => row.id) } } }) } catch { failures.push('fixture-avatar-metadata') }
    if (propertyId) {
      try { await prisma.property.deleteMany({ where: { id: propertyId } }) } catch { failures.push('fixture-property') }
    }
    try { await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } }) } catch { failures.push('fixture-users') }
    for (const delegate of [...new Set(fixtures.map((row) => row.delegate))]) {
      try {
        const remaining = await prisma[delegate].count({ where: { id: { in: fixtures.filter((row) => row.delegate === delegate).map((row) => row.id) } } })
        if (remaining) failures.push('remaining-fixture-metadata')
      } catch { failures.push('fixture-metadata-verification') }
    }
    try {
      if (await prisma.user.count({ where: { id: { in: users.map((user) => user.id) } } })) failures.push('remaining-fixture-users')
    } catch { failures.push('fixture-user-verification') }
    for (const row of fixtures) {
      try { if (await objectExists(row.key, row.bucket)) failures.push('remaining-fixture-object') } catch { failures.push('fixture-object-verification') }
    }
    await prisma.$disconnect()
    if (failures.length) throw new Error(`Cleanup smoke fixture removal failed: ${failures.join(', ')}`)
  }
  if (testError) throw testError
  console.log('PASS temporary cleanup fixture records and objects removed')
}

main().catch((error) => { console.error('Cleanup acceptance failed:', error instanceof Error ? error.message : 'unknown error'); process.exitCode = 1 })
