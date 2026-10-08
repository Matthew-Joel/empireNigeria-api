const { test } = require('node:test')
const assert = require('node:assert/strict')
const { nextCleanupAt } = require('../../deployment/storage/cleanup-scheduler.cjs')

test('scheduler selects the next fixed UTC six-hour boundary regardless of local timezone', () => {
  for (const [input, expected] of [
    ['2026-10-07T00:00:00.000Z', '2026-10-07T06:00:00.000Z'],
    ['2026-10-07T05:59:59.000Z', '2026-10-07T06:00:00.000Z'],
    ['2026-10-07T06:00:00.000Z', '2026-10-07T12:00:00.000Z'],
    ['2026-10-07T18:45:00.000Z', '2026-10-08T00:00:00.000Z'],
  ]) assert.equal(nextCleanupAt(Date.parse(input)).toISOString(), expected)
})
