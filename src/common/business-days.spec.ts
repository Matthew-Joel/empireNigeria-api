import { addBusinessDays } from './business-days'

describe('addBusinessDays', () => {
  it('moves forward one working day on a weekday', () => {
    expect(addBusinessDays(new Date('2026-10-26T09:00:00Z'), 1).toISOString()).toBe('2026-10-27T09:00:00.000Z')
  })

  it('skips the weekend from a Friday', () => {
    expect(addBusinessDays(new Date('2026-10-30T09:00:00Z'), 1).toISOString()).toBe('2026-11-02T09:00:00.000Z')
  })

  it('counts from the next weekday when started on a weekend', () => {
    expect(addBusinessDays(new Date('2026-10-31T09:00:00Z'), 1).toISOString()).toBe('2026-11-02T09:00:00.000Z')
  })

  it('adds several working days across a weekend', () => {
    expect(addBusinessDays(new Date('2026-10-28T09:00:00Z'), 3).toISOString()).toBe('2026-11-02T09:00:00.000Z')
  })

  it('uses the Lagos weekday near midnight', () => {
    // 23:30 UTC on Friday is already Saturday 00:30 in Lagos.
    expect(addBusinessDays(new Date('2026-10-30T23:30:00Z'), 1).toISOString()).toBe('2026-11-01T23:30:00.000Z')
  })

  it('returns the same moment for zero days', () => {
    expect(addBusinessDays(new Date('2026-10-26T09:00:00Z'), 0).toISOString()).toBe('2026-10-26T09:00:00.000Z')
  })
})
