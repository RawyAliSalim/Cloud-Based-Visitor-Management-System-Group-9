# Security measures

CORS is **not** listed here as a security measure: it only tells browsers which other websites may read our API responses. The measures below are what actually protect the system.

| # | Threat | Measure | Where | Test |
|---|---|---|---|---|
| 1 | Stolen or guessed passwords | Passwords stored only as bcrypt hashes (cost 10); the hash is never returned (`select: false`, removed in `toJSON`) | `models/User.js`, `scripts/seed.js` | `baseline.test.js` |
| 2 | Password guessing (brute force) | 5 failed sign-ins for one email in 15 min lock that email for 15 min; 20 failures from one IP block that IP. Counters live in MongoDB with a TTL index, so the limit also works on serverless. Locked requests get 429 + `Retry-After`. | `services/loginLimiter.service.js`, `models/LoginAttempt.js` | `security.test.js` |
| 3 | Finding out which emails have accounts | Same 401 message for unknown email and wrong password; a dummy bcrypt compare keeps the timing the same | `controllers/auth.controller.js` | `security.test.js` |
| 4 | Session hijacking / fixation | Server-side sessions in MongoDB; cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, 8 h lifetime; a new session id is issued at sign-in; logout destroys the session | `config/session.js`, `auth.controller.js` | `security.test.js` |
| 5 | Access after an account is disabled | Every authenticated request re-checks that the user still exists and is active; a disabled user's session is destroyed at once, and role changes apply on the next request | `middleware/requireAuth.js` | `security.test.js` |
| 6 | Doing things your role must not do | Role checks on every protected route (front-desk / host / admin), and ownership checks so hosts only see and change their own visits | `middleware/requireRole.js`, controllers | all test files |
| 7 | Cross-site request forgery (CSRF) | State-changing requests whose `Origin` is another website get 403, on top of the `SameSite=Lax` cookie | `middleware/sameOrigin.js` | `security.test.js` |
| 8 | NoSQL injection (`{"email": {"$ne": null}}`) | Request field names starting with `$` or containing `.` are refused (400); all ids are checked to be ObjectIds; search text is regex-escaped | `middleware/sanitizeInput.js`, `middleware/validate.js` | `security.test.js` |
| 9 | Bad or malicious input (XSS, huge payloads) | Server-side validation of every field (types, lengths, formats), control characters and `<` `>` removed or refused, 100 kB body limit, React escapes output, HTML in emails is escaped | `controllers/visits.controller.js`, `app.js` | `registration.test.js` |
| 10 | Clickjacking, MIME sniffing, data in caches | Security headers on every API response (`X-Frame-Options: DENY`, `nosniff`, strict CSP, `Cache-Control: no-store`, HSTS in production) and on the web app via `vercel.json` (CSP, frame blocking, HSTS) | `middleware/securityHeaders.js`, `vercel.json` | `security.test.js` |
| 11 | CSV export opened in Excel running formulas | Cells starting with `= + - @` are prefixed with `'` | `services/report.service.js` | `checkin.test.js` |
| 12 | Leaking internals in errors | One error format `{ error: { code, message } }`; stack traces only in development logs, never in responses | `middleware/errorHandler.js` | `security.test.js` |
| 13 | Secrets in the code | Secrets only in environment variables (`.env` is git-ignored; Vercel env vars in production); locally they can be kept in AWS Secrets Manager (see `docs/aws.md`) | `.gitignore`, `.env.example` | — |
| 14 | No record of attacks | Structured security logs: `auth.login_failed`, `auth.login_blocked`, `auth.session_revoked`, `security.cross_site_request_blocked`, with request id; passwords, tokens, emails and phone numbers are redacted | `utils/logger.js` | — |

## Settings
`LOGIN_MAX_ATTEMPTS_PER_EMAIL` (5), `LOGIN_MAX_ATTEMPTS_PER_IP` (20), `LOGIN_WINDOW_MINUTES` (15), `LOGIN_LOCK_MINUTES` (15).

## Known limits
- The per-IP limit uses the client IP reported by the proxy (`trust proxy` = 1). On Vercel this is set by Vercel; when the API is called directly (local development) a client could fake it, but the per-email lock still applies.
- There is no self-service password reset or multi-factor sign-in; accounts are created by the seed script / administrator.
