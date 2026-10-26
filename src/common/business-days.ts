const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
// Nigeria is UTC+1 all year, so a fixed offset gives the local weekday.
const LAGOS_OFFSET = HOUR

// Adds working days (Monday to Friday, Africa/Lagos) and keeps the time of day.
// Public holidays are not modelled.
export function addBusinessDays(from: Date, days: number) {
  let local = from.getTime() + LAGOS_OFFSET
  for (let added = 0; added < days;) {
    local += DAY
    const weekday = new Date(local).getUTCDay()
    if (weekday !== 0 && weekday !== 6) added += 1
  }
  return new Date(local - LAGOS_OFFSET)
}
