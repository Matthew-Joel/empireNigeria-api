// Read-only SQL acceptance: no accounts, records, files, or emails are created.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { ConfigService } = require('@nestjs/config')
const { UserRole } = require('@prisma/client')
const { PrismaService } = require('../dist/database/prisma.service')
const { ReportsService } = require('../dist/modules/reports/reports.service')
const { AdminService } = require('../dist/modules/admin/admin.service')

const keys = ['properties', 'bookings', 'maintenance', 'completedMaintenance', 'inspections', 'reports', 'recordedExpensesNgn', 'bookedValueNgn']
const snapshotKeys = ['totalProperties', 'approvedProperties', 'occupiedProperties', 'shortLetProperties', 'openMaintenance', 'completedMaintenance', 'inspectionsOpen', 'inspectionsReported', 'bookingRequests', 'confirmedBookings', 'openTasks', 'recordedExpensesNgn']

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const connection = new URL(process.env.DATABASE_URL)
  for (const [key, value] of [['connect_timeout', '15'], ['pool_timeout', '15'], ['socket_timeout', '30']]) {
    connection.searchParams.set(key, value)
  }
  process.env.DATABASE_URL = connection.toString()
  const prisma = new PrismaService()
  try {
    await prisma.$connect()
    const reports = new ReportsService(prisma)
    const actor = { sub: randomUUID(), email: 'readonly-report-check@example.invalid', role: UserRole.ADMIN }
    const report = await reports.summary(actor)
    assert.equal(report.period.timeZone, 'Africa/Lagos')
    assert.equal(report.series.length, 6)
    assert.equal(report.paymentMetricsAvailable, false)
    for (const key of keys) {
      assert.equal(report.activityTotals[key], report.series.reduce((sum, month) => sum + month[key], 0))
      assert.ok(Number.isFinite(report.activityTotals[key]) && report.activityTotals[key] >= 0)
    }
    console.log('PASS monthly report SQL, zero-filled months, activity sums, and payment distinction')
    for (const role of [UserRole.OWNER, UserRole.PROPERTY_MANAGER]) {
      const isolated = await reports.summary({ ...actor, role }, { from: '2026-09-30', to: '2026-10-01' })
      for (const key of keys) assert.equal(isolated.activityTotals[key], 0)
      for (const key of snapshotKeys) assert.equal(isolated[key], 0)
      assert.deepEqual(isolated.series.map((month) => month.month), ['2026-09', '2026-10'])
      console.log('PASS ' + role + ' cannot read another account portfolio or money totals')
    }
    const overview = await new AdminService(prisma, new ConfigService(), {}).overview()
    assert.equal(Object.keys(overview.metricActivity).length, 6)
    for (const comparison of Object.values(overview.metricActivity)) {
      assert.ok(Number.isInteger(comparison.current) && comparison.current >= 0)
      assert.ok(Number.isInteger(comparison.previous) && comparison.previous >= 0)
    }
    console.log('PASS administrator monthly creation-cohort SQL and all six comparisons')
    const analytics = await new AdminService(prisma, new ConfigService(), {}).analytics()
    assert.equal(analytics.timeZone, 'Africa/Lagos')
    assert.equal(analytics.months.length, 6)
    console.log('PASS administrator activity charts use the same Nigerian calendar months')
  } finally {
    await prisma.$disconnect()
  }
}

const deadline = setTimeout(() => {
  console.error('FAIL reporting smoke exceeded its 120-second deadline')
  process.exit(1)
}, 120_000)
main().catch((error) => {
  console.error('FAIL reporting smoke: ' + (error.code || error.name || 'unknown error'))
  process.exitCode = 1
}).finally(() => clearTimeout(deadline))
