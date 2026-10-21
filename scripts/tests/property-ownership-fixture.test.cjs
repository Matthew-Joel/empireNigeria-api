const assert = require('node:assert/strict')
const { test } = require('node:test')
const { submitPropertyWithOwnership } = require('../test-support/submit-property-with-ownership.cjs')

function fixture() {
  const calls = []
  const owner = { token: 'app-bearer-token' }
  const keys = new Set()
  const request = async (path, method, user, body) => {
    assert.equal(user, owner)
    calls.push({ path, method, body })
    if (path.endsWith('/files')) return { status: 201, body: { id: 'proof', uploadUrl: 'https://storage.example/upload' } }
    if (path.endsWith('/complete')) return { status: 201, body: {} }
    return { status: 201, body: { status: 'SUBMITTED' } }
  }
  const prisma = { propertyFile: { findUnique: async () => ({ id: 'proof', objectKey: 'pending/property/proof' }) } }
  return { calls, owner, keys, request, prisma, propertyId: 'property' }
}

test('operational fixtures verify required proof before submission and track both paths for cleanup', async () => {
  const input = fixture()
  await submitPropertyWithOwnership({ ...input, uploadFetch: async (url, options) => {
    assert.equal(url, 'https://storage.example/upload')
    assert.equal(options.method, 'PUT')
    assert.deepEqual(options.headers, { 'x-upsert': 'false' })
    assert.ok(options.body instanceof FormData)
    assert.equal(input.calls.length, 1, 'Do not complete or submit before upload finishes')
    return { ok: true, status: 200 }
  } })
  assert.deepEqual([...input.keys], ['pending/property/proof', 'properties/property/proof'])
  assert.deepEqual(input.calls.map(({ path }) => path), ['/properties/property/files', '/properties/property/files/proof/complete', '/properties/property/submit'])
  assert.equal(input.calls[0].body.ownershipDocumentType, 'CERTIFICATE_OF_OCCUPANCY')
})

test('a failed ownership upload leaves tracked keys but never submits the property', async () => {
  const input = fixture()
  await assert.rejects(submitPropertyWithOwnership({ ...input, uploadFetch: async () => ({ ok: false, status: 500 }) }), /Upload ownership proof/)
  assert.equal(input.calls.length, 1)
  assert.equal(input.keys.size, 2)
})
