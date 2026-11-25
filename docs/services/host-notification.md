# Host Notification Service

Owner: Mohamed Haytham

## Notification lifecycle

```
            delivered
Pending ─────────────▶ Sent
   │  temporary error (5xx, 429, timeout, network)
   ├─────────────────▶ Retrying ──(due, delivered)──▶ Sent
   │                     │  └──(attempts used up)───▶ Failed
   │                     └──(host acknowledged / visitor left / resent)──▶ Cancelled
   └─ permanent error (not configured, no address/token, 4xx) ──▶ Failed ──(staff resend)──▶ new notification
```

Each notification stores `attempts`, `maxAttempts`, `lastAttemptAt`, `nextRetryAt`, `error` and an `attemptLog` (last 20 attempts with time, result, error, duration). The record is saved as `Pending` before the provider is called, so an interrupted delivery still leaves a trace.

## Rules

| Rule | Details |
|---|---|
| Error classification | Configuration problems, missing email / push token, invalid tokens and provider 4xx (except 429) are permanent: `Failed` straight away, no retries. Everything else is temporary. |
| Quick retry | A temporary error is retried once immediately (`NOTIFICATION_INLINE_RETRIES`, delay `NOTIFICATION_INLINE_RETRY_MS`), so a short provider blip does not reach the host late. |
| Automatic retries | Then exponential backoff with ±20 % jitter: 30 s, 60 s, 120 s ... capped at 15 min (`NOTIFICATION_RETRY_BASE_SECONDS`, `NOTIFICATION_RETRY_MAX_SECONDS`), up to `NOTIFICATION_MAX_ATTEMPTS` (5) in total, then `Failed`. |
| Where retries run | Locally / in Docker a background worker in `server.js` runs every `NOTIFICATION_RETRY_INTERVAL_SECONDS` (30). On Vercel (no long-running process) due retries are processed when the notification list is opened, by the "Run due retries" button, or by any scheduler calling `POST /api/notifications/retry-due` with `Authorization: Bearer $CRON_SECRET`. |
| No double delivery | A worker claims a retry with a 60 s lease (`lockedUntil`) before delivering, so parallel workers never send the same retry twice. |
| Retries that no longer make sense stop | If the host has acknowledged, or the visit is no longer Checked-in, the retry is `Cancelled` (`ALREADY_ACKNOWLEDGED` / `VISIT_NO_LONGER_ON_SITE`) instead of being sent. |
| No duplicate arrival notifications | The first notification per visit and channel has a unique `dedupeKey`. Calling the arrival notification twice for one visit sends nothing new. |
| Acknowledgement covers the visit | Acknowledging any notification of a visit marks all of that visit's notifications as acknowledged (`acknowledgedAt`, `acknowledgedBy`) and stops pending retries. A second or simultaneous acknowledgement gets 409. Only possible while the visitor is checked in (409 `VISIT_NOT_ON_SITE`). |
| Manual resend | Only `Failed` or `Retrying`, not yet resent, not acknowledged, visitor still checked in (409 `NOTIFICATION_NOT_FAILED` / `NOTIFICATION_ALREADY_RESENT` / `NOTIFICATION_ALREADY_ACKNOWLEDGED` / `VISIT_NOT_ON_SITE`). The original is atomically marked `supersededBy`, so simultaneous clicks create one resend. A resend within `NOTIFICATION_RESEND_COOLDOWN_SECONDS` (30) of the last attempt gets 429 with `Retry-After`. |
| Channel must be set up | A resend is refused (409 `CHANNEL_NOT_CONFIGURED`) while that channel is not configured on the server right now (email: `EMAIL_API_KEY` + `EMAIL_FROM`; push: Firebase keys). The check uses the current configuration, not the old error, so notifications that failed before a channel was set up can be resent afterwards. The list returns `channelConfigured` per notification; the web app hides **Resend** and says why. |

## Endpoints added or changed

| Method | Endpoint | Roles | Notes |
|---|---|---|---|
| GET | `/api/notifications?status=` | host (own), front-desk, admin | Status can be Pending, Sent, Retrying, Failed, Cancelled. Also processes up to 5 due retries first. |
| POST | `/api/notifications/:id/acknowledge` | host (recipient) | Response has `acknowledgedCount` and `stoppedRetries` |
| POST | `/api/notifications/:id/resend` | front-desk, admin | 201 new notification; 409 / 429 as above |
| POST | `/api/notifications/retry-due` | front-desk, admin, or `Bearer CRON_SECRET` | Runs due retries now; returns counts |
| GET | `/api/notifications/summary?hours=24` | front-desk, admin | Counts per status, delivery rate and average attempts per channel, average host response time, visitors whose host has not answered for `NOTIFICATION_ESCALATION_MINUTES` (10), and visitors whose host could not be reached on any channel |

`EMAIL_API_URL` (optional) overrides the Brevo endpoint; the tests use it to point at a local fake provider.

## Tests
`tests/integration/notifications.test.js` runs a fake email provider and covers: first-attempt success, quick retry, permanent 4xx, backoff timing, scheduled retries up to the attempt limit, retries via the list endpoint, cancelling retries after checkout, parallel workers, cron-secret auth, duplicate prevention, visit-wide and simultaneous acknowledgements, resend once / simultaneous resends / pointless resends / cooldown, and the summary.
