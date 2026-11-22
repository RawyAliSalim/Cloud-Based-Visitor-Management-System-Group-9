# Check-in/Check-out and Visitor Log Service

Owner: Mostafa Raafat Mohamed

## Visit state machine

```
            check-in                check-out
Expected ───────────▶ Checked-in ───────────▶ Checked-out
    │
    └──── cancel ────▶ Cancelled
```

Allowed transitions live in `Visit.TRANSITIONS`. `visit.service.changeStatus()` refuses anything else and performs the change atomically (`findOneAndUpdate` on the current status), so concurrent requests cannot both win. Every change is appended to `statusHistory` (`from`, `to`, `at`, `by`); creation adds the first `Expected` entry.

## Check-in rules

| Rule | Response |
|---|---|
| Visit must be Expected (message says whether it is already checked in, finished or cancelled) | 409 `VISIT_NOT_EXPECTED` |
| Not earlier than `CHECKIN_EARLY_MINUTES` (default 120) before the expected arrival | 409 `CHECK_IN_TOO_EARLY`, `details.opensAt` |
| Not later than `CHECKIN_LATE_HOURS` (default 12) after the expected arrival | 409 `VISIT_EXPIRED` |
| The host account must still be active | 409 `HOST_UNAVAILABLE` |
| The visitor must not already be on site on another visit | 409 `VISITOR_ALREADY_ON_SITE`, `details.visitId` |
| Five simultaneous check-in requests: one succeeds, one set of host notifications is sent | 200 + 409s |

Check-in and check-out record who did it (`checkedInBy`, `checkedOutBy`). Responses include `durationMinutes`; Checked-in visits also include `overstay` (on site longer than `OVERSTAY_HOURS`, default 8).

## Visitor log and real-time board
- `GET /api/visits` adds `dateField=expected|checkIn|checkOut` so the date filter can target arrival or departure times. List responses leave out `statusHistory` to stay small.
- `GET /api/visits/on-site` includes time on site and overstay flags; the On site page refreshes every 15 s while visible.
- `GET /api/visits/:id` includes `statusHistory` (with names), `checkedInBy`, `checkedOutBy`, `durationMinutes`.

## Reports (front-desk, admin)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/visits/reports/activity?from=&to=&hostId=&tz=` | Totals by status, no-shows, cancellation and attendance rates, average/longest visit, late arrivals, visits per host, visits per day, busiest check-in hours, current overstays. One MongoDB aggregation (`$facet`). Default range: last 7 days plus the next 24 h; at most 92 days. `tz` is an IANA zone (default `REPORT_TIMEZONE` or UTC). |
| GET | `/api/visits/reports/export?from=&to=&hostId=` | Visitor log as CSV (max 5000 rows). Cells that start with `= + - @` are prefixed with `'` to block spreadsheet formula injection. |

The web app has a Reports page (staff only) with the summary and an Export CSV button.

## Tests
`tests/integration/checkin.test.js`: check-in window, expired visits, inactive hosts, visitor already on site, concurrent check-ins, history entries, invalid transitions, overstay flags, date-field filters, report contents and validation, CSV escaping.
