import { reportingPeriod } from './reporting-period'

describe('Nigerian report dates', () => {
  it('uses inclusive Nigerian days and fills calendar months, including empty ones', () => {
    const result = reportingPeriod({ from: '2026-09-30', to: '2026-10-01' })
    expect(result.start.toISOString()).toBe('2026-09-29T23:00:00.000Z')
    expect(result.end.toISOString()).toBe('2026-10-01T23:00:00.000Z')
    expect(result.months.map((row) => row.month)).toEqual(['2026-09', '2026-10'])
  })
  it('defaults to the last six calendar months using the Nigerian date at midnight', () => {
    const result = reportingPeriod({}, new Date('2026-09-30T23:30:00.000Z'))
    expect([result.from, result.to]).toEqual(['2026-05-01', '2026-10-01'])
  })
  it.each([
    { from: '2026-02-30', to: '2026-03-10' },
    { from: '2026-1-01', to: '2026-03-10' },
    { from: '2026-10-11', to: '2026-10-10' },
    { from: '2024-01-01', to: '2026-10-10' },
  ])('rejects invalid or unbounded date ranges %j', (dates) => {
    expect(() => reportingPeriod(dates)).toThrow()
  })
})
