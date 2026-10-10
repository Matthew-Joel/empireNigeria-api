# Portfolio reporting

`GET /api/v1/reports` is available to Admin, Owner, and Property Manager. Owner queries use owned properties; manager queries use currently assigned properties. Booking values and expense aggregates use the same property scope. Other roles are rejected.

Optional `from` and `to` are inclusive `YYYY-MM-DD` calendar dates in `Africa/Lagos`. Invalid dates, reversed intervals, and intervals longer than 366 days return HTTP 400. The default starts on the first day five months before the selected end date and ends today. Timestamp queries use a half-open UTC interval; missing months are returned with zeros.

Existing scalar keys remain a current portfolio snapshot, including all-time recorded expenses. `period`, `series`, and `activityTotals` describe activity within the selected dates. Changing dates never reconstructs historical inventory or queue statuses.

| Activity field | Event date / meaning |
| --- | --- |
| `properties` | Property record creation |
| `bookings` | Booking request creation, including requests now declined/cancelled |
| `maintenance` | Request reported date |
| `completedMaintenance` | Work completion date, including work since closed |
| `inspections` | Inspection record creation, rather than visit date |
| `reports` | Inspection report submission |
| `recordedExpensesNgn` | Recorded expenses by incurred calendar date |
| `bookedValueNgn` | Currently confirmed/completed bookings grouped by booking creation date |

Booking values are reservation amounts, not received income. Payment collection, reconciliation, and revenue reporting remain deferred. Series and selected-period totals may change when a booking changes status. Current access/assignment determines which property history a user can see.

`GET /api/v1/admin/overview` additionally supplies six `metricActivity` comparisons with `activityPeriod`. These compare creation cohorts in the current month so far against the complete previous month. Status-based cards filter by **current** account/property status, not the status at the end of either month. The frontend states this basis and avoids misleading historical queue percentages.

No schema migration is required. After building, `node --env-file=.env scripts/reporting-smoke.cjs` runs bounded read-only hosted-database checks; it creates no fixtures and sends no email. It verifies SQL execution and empty account scopes. Unit tests cover date validation, month padding, role constraints, and creation-cohort semantics. These checks do not establish browser rendering or past-state reconstruction.
