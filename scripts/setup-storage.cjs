const projectUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
const secretKey = process.env.SUPABASE_SECRET_KEY
const legacyKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const key = secretKey || legacyKey
if (!projectUrl || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) before running storage setup.')
  process.exit(1)
}

const propertyBucket = process.env.SUPABASE_STORAGE_BUCKET || 'property-files'
const profileBucket = process.env.SUPABASE_PROFILE_BUCKET || 'profile-images'
if (propertyBucket === profileBucket) {
  console.error('Property and profile bucket names must be different.')
  process.exit(1)
}

async function request(path, method, body) {
  const response = await fetch(`${projectUrl}/storage/v1${path}`, {
    method,
    headers: {
      apikey: key,
      ...(secretKey ? {} : { Authorization: `Bearer ${key}` }),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    let code
    try { code = JSON.parse(detail).code } catch { /* Preserve the response text below. */ }
    if (method === 'GET' && path.startsWith('/bucket/') && (response.status === 404 || code === 'NoSuchBucket')) return null
    throw new Error(`Storage setup failed (${response.status}): ${detail.slice(0, 300)}`)
  }
  return response
}

async function ensureBucket(id, allowedMimeTypes) {
  const settings = { id, name: id, public: false, file_size_limit: 5_000_000, allowed_mime_types: allowedMimeTypes }
  const existing = await request(`/bucket/${encodeURIComponent(id)}`, 'GET')
  if (!existing) {
    await request('/bucket', 'POST', settings)
    console.log(`Created private bucket ${id} (5 MB).`)
    return
  }
  const current = await existing.json()
  const sameTypes = JSON.stringify([...(current.allowed_mime_types || [])].sort()) === JSON.stringify([...allowedMimeTypes].sort())
  if (current.public !== false || Number(current.file_size_limit) !== 5_000_000 || !sameTypes) {
    throw new Error(`Bucket ${id} already exists with different privacy, size, or MIME settings. Review it in Supabase before rerunning setup.`)
  }
  console.log(`Verified private bucket ${id} (5 MB).`)
}

Promise.resolve()
  .then(() => ensureBucket(propertyBucket, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']))
  .then(() => ensureBucket(profileBucket, ['image/jpeg', 'image/png', 'image/webp']))
  .catch((error) => { console.error(error.message); process.exitCode = 1 })
