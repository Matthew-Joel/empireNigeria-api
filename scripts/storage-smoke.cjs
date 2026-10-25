/* Live Supabase smoke test. Creates run-scoped PostgreSQL users/property and
 * Storage objects, then removes them in finally. No email is sent. */
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

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64')
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')

async function main() {
  const profileOnly = process.argv.includes('--profile-only')
  const app = await NestFactory.create(AppModule, { logger: ['error'] })
  const prisma = app.get(PrismaService)
  const storage = app.get(SupabaseStorageService)
  const jwt = app.get(JwtService)
  const run = randomUUID().slice(0, 12)
  const userIds = []
  const propertyKeys = new Set()
  const avatarKeys = new Set()
  let propertyId
  configureApp(app)

  try {
    const users = {}
    for (const label of ['owner', 'other']) {
      const user = await prisma.user.create({ data: { email: `storage-smoke-${run}-${label}@example.invalid`, passwordHash: 'unused-test-fixture', role: 'OWNER', status: 'ACTIVE', emailVerifiedAt: new Date(), profile: { create: { firstName: 'Storage', lastName: label } } } })
      userIds.push(user.id)
      users[label] = { ...user, token: jwt.sign({ sub: user.id, email: user.email, role: user.role, version: 0 }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '10m' }) }
    }
    await app.listen(0, '127.0.0.1')
    const base = `${await app.getUrl()}/api/v1`
    async function request(path, method, user, body) {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${user.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
      return { status: response.status, body: await response.json().catch(() => null) }
    }
    async function upload(start, bytes, name, type) {
      assert.ok(start.body?.uploadUrl, 'Expected a signed upload URL')
      const form = new FormData()
      form.append('cacheControl', '60')
      form.append('', new Blob([bytes], { type }), name)
      const response = await fetch(start.body.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form, signal: AbortSignal.timeout(30_000) })
      assert.ok(response.ok, `Supabase upload returned HTTP ${response.status}`)
    }
    async function expectFile(url, expected) {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      assert.equal(response.status, 200, 'Signed file URL should be readable')
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected)
    }

    async function shortSigned(key, bucket) {
      const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
      const storageBase = process.env.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1'
      const path = [bucket, ...key.split('/')].map(encodeURIComponent).join('/')
      const response = await fetch(`${storageBase}/object/sign/${path}`, { method: 'POST', headers: { apikey: secret, ...(process.env.SUPABASE_SECRET_KEY ? {} : { Authorization: `Bearer ${secret}` }), 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 2 }), signal: AbortSignal.timeout(15_000) })
      assert.equal(response.ok, true, 'Create a short-lived, never-fetched fixture URL to verify origin expiry')
      const data = await response.json()
      return new URL(storageBase + (data.signedURL || data.signedUrl)).toString()
    }

    let shortExpiryUrl
    if (!profileOnly) {
    const draft = { name: 'Temporary storage test', type: 'Apartment', description: 'Run-scoped storage verification property.', address: '1 Test Street', city: 'Lagos', state: 'Lagos', country: 'Nigeria', occupancyStatus: 'VACANT' }
    const created = await request('/properties', 'POST', users.owner, draft)
    assert.equal(created.status, 201, 'Create property')
    propertyId = created.body.id
    const filesPath = `/properties/${propertyId}/files`
    assert.equal((await request(filesPath, 'POST', users.owner, { purpose: 'PHOTO', fileName: 'too-large.png', contentType: 'image/png', sizeBytes: 5_000_001 })).status, 400, 'Reject files over 5 MB')
    assert.equal((await request(filesPath, 'POST', users.owner, { purpose: 'PHOTO', fileName: 'invalid.svg', contentType: 'image/svg+xml', sizeBytes: 100 })).status, 400, 'Reject unsupported file type')
    assert.equal((await request(filesPath, 'POST', users.other, { purpose: 'PHOTO', fileName: 'other.png', contentType: 'image/png', sizeBytes: png.length })).status, 404, 'Other owner cannot upload')
    assert.equal((await request('/auth/me/avatar/uploads', 'POST', users.owner, { contentType: 'application/pdf', sizeBytes: pdf.length })).status, 400, 'Profile bucket accepts images only')
    assert.equal((await request('/auth/me/avatar/uploads', 'POST', users.owner, { contentType: 'image/png', sizeBytes: 5_000_001 })).status, 400, 'Profile 5 MB limit')
    async function pendingPhoto(name, sizeBytes = png.length, isCover = false) {
      const started = await request(filesPath, 'POST', users.owner, { purpose: 'PHOTO', fileName: name, contentType: 'image/png', sizeBytes, isCover })
      assert.equal(started.status, 201, `Prepare ${name}: ${JSON.stringify(started.body)}`)
      const row = await prisma.propertyFile.findUnique({ where: { id: started.body.id } })
      propertyKeys.add(row.objectKey)
      propertyKeys.add(`properties/${propertyId}/${row.id}`)
      return started
    }
    for (const invalid of [
      { name: 'size-spoof.png', bytes: Buffer.concat([png, Buffer.from('extra')]), declared: png.length },
      { name: 'type-spoof.png', bytes: pdf, declared: pdf.length },
    ]) {
      const started = await pendingPhoto(invalid.name, invalid.declared)
      await upload(started, invalid.bytes, invalid.name, 'image/png')
      assert.equal((await request(`${filesPath}/${started.body.id}/complete`, 'POST', users.owner)).status, 400, 'Actual bytes must match the declared type and size')
      assert.equal((await prisma.propertyFile.findUnique({ where: { id: started.body.id } })).status, 'PENDING', 'Invalid bytes never become ready')
      assert.equal((await request(`${filesPath}/${started.body.id}/url`, 'GET', users.owner)).status, 404, 'Invalid pending uploads cannot be viewed')
    }
    const expired = await pendingPhoto('expired.png')
    await prisma.propertyFile.update({ where: { id: expired.body.id }, data: { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } })
    assert.equal((await request(`${filesPath}/${expired.body.id}/complete`, 'POST', users.owner)).status, 400, 'Expired uploads cannot complete')
    const oversized = await pendingPhoto('bucket-limit.png')
    const largeForm = new FormData()
    largeForm.append('', new Blob([Buffer.alloc(5_000_001)], { type: 'image/png' }), 'bucket-limit.png')
    const bucketLimit = await fetch(oversized.body.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: largeForm, signal: AbortSignal.timeout(30_000) })
    assert.equal(bucketLimit.ok, false, 'Supabase bucket independently enforces the 5 MB limit')
    console.log('PASS private upload permissions, profile restrictions, API/bucket size limits, spoofed bytes, and expired uploads')

    for (const file of [{ purpose: 'PHOTO', name: 'photo.png', type: 'image/png', bytes: png }, { purpose: 'DOCUMENT', name: 'record.pdf', type: 'application/pdf', bytes: pdf }]) {
      const started = await request(filesPath, 'POST', users.owner, { purpose: file.purpose, fileName: file.name, contentType: file.type, sizeBytes: file.bytes.length, isCover: file.purpose === 'PHOTO' })
      assert.equal(started.status, 201, `Start ${file.purpose} upload`)
      const pending = await prisma.propertyFile.findUnique({ where: { id: started.body.id } })
      propertyKeys.add(pending.objectKey)
      propertyKeys.add(`properties/${propertyId}/${started.body.id}`)
      await upload(started, file.bytes, file.name, file.type)
      const completed = file.purpose === 'PHOTO'
        ? await Promise.all([request(`${filesPath}/${started.body.id}/complete`, 'POST', users.owner), request(`${filesPath}/${started.body.id}/complete`, 'POST', users.owner)])
        : [await request(`${filesPath}/${started.body.id}/complete`, 'POST', users.owner)]
      for (const result of completed) assert.equal(result.status, 201, `Complete ${file.purpose} upload idempotently: ${JSON.stringify(result.body)}`)
      assert.equal((await request(`${filesPath}/${started.body.id}/url`, 'GET', users.other)).status, 404, 'Other owner cannot access file')
      const signed = await request(`${filesPath}/${started.body.id}/url?download=false`, 'GET', users.owner)
      assert.equal(signed.status, 200, `Sign ${file.purpose} read`)
      assert.equal(signed.body.expiresInSeconds, 60, 'API issues 60-second access URLs')
      await expectFile(signed.body.url, file.bytes)
      const publicUrl = new URL(signed.body.url)
      publicUrl.pathname = publicUrl.pathname.replace('/object/sign/', '/object/public/')
      publicUrl.search = ''
      assert.equal((await fetch(publicUrl, { signal: AbortSignal.timeout(15_000) })).ok, false, 'Private bucket rejects anonymous public reads')
      if (file.purpose === 'DOCUMENT') {
        shortExpiryUrl = await shortSigned(`properties/${propertyId}/${started.body.id}`, storage.propertyBucket)
      }
    }
    const property = await request(`/properties/${propertyId}`, 'GET', users.owner)
    assert.equal(property.body.files.length, 2, 'Property should expose ready files')
    const coverUploads = await Promise.all([pendingPhoto('cover-a.png', png.length, true), pendingPhoto('cover-b.png', png.length, true)])
    await Promise.all(coverUploads.map((started) => upload(started, png, 'cover.png', 'image/png')))
    const coverCompletions = await Promise.all(coverUploads.map((started) => request(`${filesPath}/${started.body.id}/complete`, 'POST', users.owner)))
    for (const result of coverCompletions) assert.equal(result.status, 201, `Concurrent cover completion: ${JSON.stringify(result.body)}`)
    assert.equal(await prisma.propertyFile.count({ where: { propertyId, status: 'READY', isCover: true } }), 1, 'Concurrent uploads leave exactly one cover')
    console.log('PASS real photo/document bytes, private signed reads, idempotent completion, and concurrent cover replacement')
    }

    let oldAvatarKey
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = await request('/auth/me/avatar/uploads', 'POST', users.owner, { contentType: 'image/png', sizeBytes: png.length })
      assert.equal(started.status, 201, 'Start avatar upload')
      const pending = await prisma.profileImageUpload.findUnique({ where: { id: started.body.id } })
      avatarKeys.add(pending.objectKey)
      avatarKeys.add(`profiles/${users.owner.id}/${started.body.id}`)
      await upload(started, png, `avatar-${attempt}.png`, 'image/png')
      const completed = await request(`/auth/me/avatar/uploads/${started.body.id}/complete`, 'POST', users.owner)
      assert.equal(completed.status, 201, `Complete avatar upload: ${JSON.stringify(completed.body)}`)
      await expectFile(completed.body.url, png)
      const profile = await prisma.userProfile.findUnique({ where: { userId: users.owner.id }, select: { avatarObjectKey: true } })
      assert.equal(profile.avatarObjectKey, `profiles/${users.owner.id}/${started.body.id}`, 'Avatar should point to the completed object')
      if (attempt === 0) {
        oldAvatarKey = profile.avatarObjectKey
      }
      else assert.notEqual(profile.avatarObjectKey, oldAvatarKey, 'Replacing avatar should change its object key')
      if (profileOnly && attempt === 1) shortExpiryUrl = await shortSigned(profile.avatarObjectKey, storage.profileBucket)
    }
    if (profileOnly) await new Promise((resolve) => setTimeout(resolve, 3100))
    assert.equal((await fetch(shortExpiryUrl, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).ok, false, 'Never-cached signed URL is rejected after expiry while the object still exists')
    assert.equal((await request('/auth/me/avatar', 'DELETE', users.owner)).status, 200, 'Remove avatar')
    assert.equal((await request('/auth/me/avatar', 'GET', users.owner)).body.url, null, 'Removed avatar is no longer shown')
    console.log(profileOnly ? 'PASS live profile upload/replacement/removal and signed reads.' : 'PASS live property photo, document, profile image upload/replacement/removal, signed reads, size/type limits, and owner scope.')
  } finally {
    const cleanupErrors = []
    try {
      for (const key of propertyKeys) await storage.remove(key).catch(() => cleanupErrors.push('property'))
      for (const key of avatarKeys) await storage.remove(key, storage.profileBucket).catch(() => cleanupErrors.push('avatar'))
      if (userIds.length) await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })
      if (propertyId) await prisma.property.deleteMany({ where: { id: propertyId } })
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    } finally {
      await app.close()
    }
    if (cleanupErrors.length) throw new Error(`Storage cleanup had ${cleanupErrors.length} error(s); inspect run ${run}.`)
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Storage smoke test failed'); process.exitCode = 1 })
