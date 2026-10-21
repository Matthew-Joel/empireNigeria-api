const assert = require('node:assert/strict')

// Small run-scoped ownership fixture for operational smoke tests. It follows
// the same signed-upload, verification, and submission API as an owner.
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')

async function submitPropertyWithOwnership({ request, prisma, propertyId, owner, keys, uploadFetch = fetch }) {
  const path = `/properties/${propertyId}`
  const started = await request(`${path}/files`, 'POST', owner, {
    purpose: 'DOCUMENT', ownershipDocumentType: 'CERTIFICATE_OF_OCCUPANCY',
    fileName: 'ownership-smoke.pdf', contentType: 'application/pdf', sizeBytes: pdf.length,
  })
  assert.equal(started.status, 201, 'Initialize required ownership proof upload')
  assert.ok(started.body?.id && started.body?.uploadUrl, 'Ownership upload must include an ID and signed URL')
  const row = await prisma.propertyFile.findUnique({ where: { id: started.body.id } })
  assert.ok(row?.objectKey, 'Ownership upload must have a tracked Storage path')
  keys.add(row.objectKey)
  keys.add(`properties/${propertyId}/${row.id}`)

  const form = new FormData()
  form.append('cacheControl', '60')
  form.append('', new Blob([pdf], { type: 'application/pdf' }), 'ownership-smoke.pdf')
  const uploaded = await uploadFetch(started.body.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form, signal: AbortSignal.timeout(30_000) })
  assert.equal(uploaded.ok, true, `Upload ownership proof to private Storage: HTTP ${uploaded.status}`)
  assert.equal((await request(`${path}/files/${row.id}/complete`, 'POST', owner)).status, 201, 'Verify ownership proof upload')
  const submitted = await request(`${path}/submit`, 'POST', owner)
  assert.equal(submitted.status, 201, 'Submit property with completed ownership proof')
  assert.equal(submitted.body?.status, 'SUBMITTED', 'Completed ownership proof allows review submission')
  return row.id
}

module.exports = { submitPropertyWithOwnership }
