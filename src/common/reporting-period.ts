import { BadRequestException } from '@nestjs/common'

const DAY_MS = 86_400_000
export const REPORT_TIME_ZONE = 'Africa/Lagos'
export interface ReportDates { from?: string; to?: string }

function calendarDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Use valid YYYY-MM-DD report dates')
  }
  return date
}

/** Inclusive Nigerian calendar dates; timestamps use a half-open UTC interval. */
export function reportingPeriod(input: ReportDates = {}, now = new Date()) {
  const today = new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10)
  const to = input.to ?? today
  const lastDay = calendarDate(to)
  const defaultFrom = new Date(lastDay)
  defaultFrom.setUTCDate(1)
  defaultFrom.setUTCMonth(defaultFrom.getUTCMonth() - 5)
  const from = input.from ?? defaultFrom.toISOString().slice(0, 10)
  const firstDay = calendarDate(from)
  const days = (lastDay.getTime() - firstDay.getTime()) / DAY_MS + 1
  if (days < 1 || days > 366) throw new BadRequestException('Choose an ordered report range of at most 366 days')
  const start = new Date(firstDay.getTime() - 3_600_000)
  const end = new Date(lastDay.getTime() + DAY_MS - 3_600_000)
  const months: Array<{ month: string; label: string }> = []
  const cursor = new Date(firstDay)
  cursor.setUTCDate(1)
  while (cursor <= lastDay) {
    months.push({ month: cursor.toISOString().slice(0, 7), label: new Intl.DateTimeFormat('en-NG', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(cursor) })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return { from, to, timeZone: REPORT_TIME_ZONE, start, end, months }
}
