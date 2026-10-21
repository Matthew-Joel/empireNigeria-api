const UPLOAD_LIFETIME_MS = 2 * 60 * 60 * 1000
// Signed URLs are issued after their metadata rows; allow them to expire first.
const CLEANUP_GRACE_MS = 5 * 60 * 1000
const kinds = [
  { name: 'propertyFiles', delegate: 'propertyFile', table: 'property_files', bucket: 'propertyBucket', hasStatus: true },
  { name: 'inspectionEvidence', delegate: 'inspectionEvidence', table: 'inspection_evidence', bucket: 'propertyBucket', hasStatus: true },
  { name: 'maintenanceEvidence', delegate: 'maintenanceEvidence', table: 'maintenance_evidence', bucket: 'propertyBucket', hasStatus: true },
  { name: 'profileImages', delegate: 'profileImageUpload', table: 'profile_image_uploads', bucket: 'profileBucket', hasStatus: false },
]

function parseCleanupOptions(args = []) {
  const options = { dryRun: false, prefix: 'pending/', batchSize: 100, maxBatches: 10 }
  const seen = new Set()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (seen.has(argument)) throw new Error('Duplicate cleanup option')
    seen.add(argument)
    if (argument === '--dry-run') { options.dryRun = true; continue }
    if (!['--prefix', '--batch-size', '--max-batches'].includes(argument)) throw new Error('Unknown cleanup option')
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error('Cleanup option requires a value')
    if (argument === '--prefix') {
      if (!value.startsWith('pending/') || value === 'pending/' || !value.endsWith('/') || value.length > 500 || /[\\\x00-\x20*?%_]/.test(value) || value.split('/').some((part) => part === '.' || part === '..')) throw new Error('Scope must be a complete pending subfolder without wildcards')
      options.prefix = value
    } else {
      const maximum = argument === '--batch-size' ? 1000 : 100
      const parsed = Number(value)
      if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error('Invalid cleanup batch bound')
      options[argument === '--batch-size' ? 'batchSize' : 'maxBatches'] = parsed
    }
  }
  return options
}

function expiredWhere(kind, cutoff, prefix) {
  const pending = { ...(kind.hasStatus ? { status: 'PENDING' } : {}), createdAt: { lt: cutoff }, objectKey: { startsWith: prefix } }
  // A committed deletion marker is no longer usable ownership evidence. The
  // global worker retries it promptly; a scoped run cannot infer its old prefix
  // when the object already has a final Storage path.
  return kind.delegate === 'propertyFile' && prefix === 'pending/' ? { OR: [pending, { status: 'DELETING' }] } : pending
}

function propertyPaths(row, prefix) {
  // These identifiers come from UUID database columns. Validate path segments
  // as well so malformed metadata cannot broaden a cleanup operation.
  if (![row.propertyId, row.id].every((value) => typeof value === 'string' && /^[a-zA-Z0-9-]+$/.test(value))) return null
  if (typeof row.objectKey !== 'string') return null
  const readyKey = `properties/${row.propertyId}/${row.id}`
  const segments = row.objectKey.split('/')
  const pendingKey = segments.length >= 3 && segments[0] === 'pending' && segments.slice(1).every((segment) => /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(segment))
  if (row.status === 'DELETING') {
    if (prefix !== 'pending/') return null
    if (row.objectKey === readyKey) return [readyKey]
    return pendingKey ? [row.objectKey, readyKey] : null
  }
  if (row.status !== 'PENDING' || !pendingKey || !row.objectKey.startsWith(prefix)) return null
  // A Storage move can succeed before its database transaction rolls back.
  // Delete both tracked candidate paths before dropping that pending metadata.
  return [row.objectKey, readyKey]
}

async function cleanupExpiredUploads({ prisma, storage, options = parseCleanupOptions(), now = new Date() }) {
  const cutoff = new Date(now.getTime() - UPLOAD_LIFETIME_MS - CLEANUP_GRACE_MS)
  const summary = { dryRun: options.dryRun, prefix: options.prefix, cutoff: cutoff.toISOString(), batchSize: options.batchSize, maxBatches: options.maxBatches, kinds: [], totals: { candidates: 0, removed: 0, wouldRemove: 0, skipped: 0, failed: 0 } }
  for (const kind of kinds) {
    const result = { kind: kind.name, batches: 0, candidates: 0, removed: 0, wouldRemove: 0, skipped: 0, failed: 0, mayHaveMore: false, failures: [] }
    let cursor
    const where = expiredWhere(kind, cutoff, options.prefix)
    for (let batch = 0; batch < options.maxBatches; batch += 1) {
      const rows = await prisma[kind.delegate].findMany({
        where: cursor ? { AND: [where, { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }] } : where,
        select: { id: true, objectKey: true, createdAt: true, ...(kind.delegate === 'propertyFile' ? { propertyId: true, status: true } : {}) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: options.batchSize,
      })
      if (!rows.length) break
      result.batches += 1
      for (const candidate of rows) {
        result.candidates += 1
        if (options.dryRun) {
          result[kind.delegate === 'propertyFile' && !propertyPaths(candidate, options.prefix) ? 'skipped' : 'wouldRemove'] += 1
          continue
        }
        try {
          const removed = await prisma.$transaction(async (tx) => {
            // These table names are constants. Upload completion takes the same lock.
            await tx.$queryRawUnsafe(`SELECT "id" FROM "${kind.table}" WHERE "id" = $1::uuid FOR UPDATE`, candidate.id)
            const current = await tx[kind.delegate].findFirst({ where: { ...where, id: candidate.id }, select: { id: true, objectKey: true, ...(kind.delegate === 'propertyFile' ? { propertyId: true, status: true } : {}) } })
            if (!current) return false
            const paths = kind.delegate === 'propertyFile' ? propertyPaths(current, options.prefix) : current.objectKey.startsWith(options.prefix) ? [current.objectKey] : null
            if (!paths) return false
            for (const path of paths) await storage.remove(path, storage[kind.bucket])
            const deleted = await tx[kind.delegate].deleteMany({ where: { ...where, id: current.id, objectKey: current.objectKey } })
            if (deleted.count !== 1) throw new Error('Locked upload changed before cleanup')
            return true
          }, { maxWait: 5000, timeout: 90_000 })
          result[removed ? 'removed' : 'skipped'] += 1
        } catch {
          // Keep the record on storage/DB failure for a retry. Never log keys/secrets.
          result.failed += 1
          result.failures.push({ id: candidate.id, reason: 'storage-or-database-failure' })
        }
      }
      cursor = rows[rows.length - 1]
      result.mayHaveMore = rows.length === options.batchSize && batch + 1 === options.maxBatches
      if (rows.length < options.batchSize) break
    }
    for (const key of Object.keys(summary.totals)) summary.totals[key] += result[key]
    summary.kinds.push(result)
  }
  return summary
}

module.exports = { parseCleanupOptions, cleanupExpiredUploads, UPLOAD_LIFETIME_MS, CLEANUP_GRACE_MS }
