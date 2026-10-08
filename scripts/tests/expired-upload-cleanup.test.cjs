const { test } = require('node:test')
const assert = require('node:assert/strict')
const { cleanupExpiredUploads, parseCleanupOptions } = require('../lib/expired-upload-cleanup.cjs')

const now = new Date('2026-10-07T12:00:00.000Z')
const old = new Date('2026-10-07T08:00:00.000Z')
const delegates = ['propertyFile', 'inspectionEvidence', 'maintenanceEvidence', 'profileImageUpload']

function matches(row, where) {
  return (!where.id || row.id === where.id)
    && (!where.status || row.status === where.status)
    && (!where.objectKey || (typeof where.objectKey === 'string' ? row.objectKey === where.objectKey : row.objectKey.startsWith(where.objectKey.startsWith)))
    && (!where.createdAt?.lt || row.createdAt < where.createdAt.lt)
    && (!where.OR || row.createdAt > where.OR[0].createdAt.gt || (row.createdAt.getTime() === where.OR[1].createdAt.getTime() && row.id > where.OR[1].id.gt))
}

function harness(initial, { onLock, onRemove } = {}) {
  const rows = Object.fromEntries(delegates.map((delegate) => [delegate, (initial[delegate] || []).map((row) => ({ ...row }))]))
  const removed = []
  const locks = []
  const prisma = {}
  for (const delegate of delegates) {
    prisma[delegate] = {
      findMany: async ({ where, take }) => rows[delegate].filter((row) => matches(row, where)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, take).map((row) => ({ ...row })),
      findFirst: async ({ where }) => rows[delegate].find((row) => matches(row, where)) || null,
      deleteMany: async ({ where }) => {
        const before = rows[delegate].length
        rows[delegate] = rows[delegate].filter((row) => !matches(row, where))
        return { count: before - rows[delegate].length }
      },
    }
  }
  prisma.$queryRawUnsafe = async (sql, id) => { locks.push({ sql, id }); if (onLock) await onLock(rows, id); return [{ id }] }
  prisma.$transaction = async (callback, options) => { assert.deepEqual(options, { maxWait: 5000, timeout: 90_000 }); return callback(prisma) }
  const storage = { propertyBucket: 'property-files', profileBucket: 'profile-images', remove: async (key, bucket) => { if (onRemove) await onRemove(key); removed.push({ key, bucket }) } }
  return { prisma, storage, rows, removed, locks }
}

const pending = (id, additions = {}) => ({ id, objectKey: `pending/fixture/${id}`, status: 'PENDING', createdAt: old, ...additions })

test('scope and batch arguments reject dangerous/invalid values', () => {
  for (const args of [['--prefix', 'properties/fixture/'], ['--prefix', 'pending/'], ['--prefix', 'pending/../fixture/'], ['--prefix', 'pending/fixture/*/'], ['--prefix', 'pending/fixture/%/'], ['--prefix', 'pending/fixture_/'], ['--batch-size', '0'], ['--batch-size', '1001'], ['--max-batches', '101'], ['--dry-run', '--dry-run'], ['--unknown']]) assert.throws(() => parseCleanupOptions(args))
  assert.deepEqual(parseCleanupOptions(['--dry-run', '--prefix', 'pending/fixture/', '--batch-size', '2', '--max-batches', '3']), { dryRun: true, prefix: 'pending/fixture/', batchSize: 2, maxBatches: 3 })
})

test('dry-run never locks or removes bytes/metadata and filters READY/recent/out-of-scope rows', async () => {
  const fixture = harness({ propertyFile: [pending('expired'), pending('ready', { status: 'READY' }), pending('recent', { createdAt: now }), pending('outside', { objectKey: 'pending/other/outside' })] })
  const summary = await cleanupExpiredUploads({ ...fixture, now, options: parseCleanupOptions(['--dry-run', '--prefix', 'pending/fixture/']) })
  assert.equal(summary.totals.wouldRemove, 1)
  assert.equal(fixture.rows.propertyFile.length, 4)
  assert.equal(fixture.removed.length, 0)
  assert.equal(fixture.locks.length, 0)
})

test('an upload completed between enumeration and locking is rechecked and preserved', async () => {
  const fixture = harness({ propertyFile: [pending('in-flight')] }, { onLock: async (rows) => { rows.propertyFile[0].status = 'READY'; rows.propertyFile[0].objectKey = 'properties/property/ready' } })
  const summary = await cleanupExpiredUploads({ ...fixture, now })
  assert.equal(summary.totals.skipped, 1)
  assert.equal(summary.totals.removed, 0)
  assert.equal(fixture.removed.length, 0)
  assert.equal(fixture.rows.propertyFile[0].status, 'READY')
  assert.match(fixture.locks[0].sql, /"property_files".*FOR UPDATE/)
})

test('five-minute grace preserves newly expired rows until delayed signed URLs expire', async () => {
  const fixture = harness({ propertyFile: [
    pending('within-grace', { createdAt: new Date(now.getTime() - (2 * 60 + 4) * 60 * 1000) }),
    pending('grace-boundary', { createdAt: new Date(now.getTime() - (2 * 60 + 5) * 60 * 1000) }),
    pending('past-grace', { createdAt: new Date(now.getTime() - (2 * 60 + 6) * 60 * 1000) }),
  ] })
  const summary = await cleanupExpiredUploads({ ...fixture, now })
  assert.equal(summary.totals.removed, 1)
  assert.deepEqual(fixture.rows.propertyFile.map((row) => row.id), ['within-grace', 'grace-boundary'])
  assert.equal(fixture.removed[0].key, 'pending/fixture/past-grace')
})

test('profile completion which consumes its temporary row is preserved', async () => {
  const fixture = harness({ profileImageUpload: [pending('profile')] }, { onLock: async (rows) => { rows.profileImageUpload = [] } })
  const summary = await cleanupExpiredUploads({ ...fixture, now })
  assert.equal(summary.totals.skipped, 1)
  assert.equal(fixture.removed.length, 0)
})

test('storage failure retains metadata for retry and allows other upload kinds to proceed', async () => {
  const fixture = harness({ propertyFile: [pending('failure')], inspectionEvidence: [pending('evidence')], profileImageUpload: [pending('avatar'), pending('final-avatar', { objectKey: 'profiles/user/final' })] }, { onRemove: async (key) => { if (key.endsWith('/failure')) throw new Error('storage offline') } })
  const summary = await cleanupExpiredUploads({ ...fixture, now })
  assert.equal(summary.totals.failed, 1)
  assert.equal(summary.totals.removed, 2)
  assert.equal(fixture.rows.propertyFile.length, 1)
  assert.equal(fixture.rows.profileImageUpload[0].objectKey, 'profiles/user/final')
  assert.deepEqual(fixture.removed.find((row) => row.key.endsWith('/avatar')), { key: 'pending/fixture/avatar', bucket: 'profile-images' })
})

test('deterministic cursor batching respects per-kind bounds then safely resumes', async () => {
  const fixture = harness({ propertyFile: ['a', 'b', 'c', 'd', 'e'].map((id) => pending(id)) })
  const options = parseCleanupOptions(['--batch-size', '2', '--max-batches', '2'])
  const first = await cleanupExpiredUploads({ ...fixture, now, options })
  assert.equal(first.totals.removed, 4)
  assert.equal(first.kinds[0].mayHaveMore, true)
  assert.deepEqual(fixture.rows.propertyFile.map((row) => row.id), ['e'])
  const second = await cleanupExpiredUploads({ ...fixture, now, options })
  assert.equal(second.totals.removed, 1)
  const third = await cleanupExpiredUploads({ ...fixture, now, options })
  assert.equal(third.totals.candidates, 0)
})
