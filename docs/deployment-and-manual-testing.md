# Deployment (Vercel + MongoDB Atlas) and manual test checklist

## Part A: Before deploying
1. Merge the two open branches into `main` (open each link, check the diff, **Create pull request**, then merge):
   - Security: `https://github.com/RawyAliSalim/Cloud-Based-Visitor-Management-System-Group-9/compare/main...feature/rawy-security-hardening`
   - AWS: `https://github.com/RawyAliSalim/Cloud-Based-Visitor-Management-System-Group-9/compare/main...feature/mostafa-aws-floci`
2. Locally: `git switch main`, `git pull`, then `docker compose run --rm --build test`. All tests should pass.

## Part B: Deploy

### B1. MongoDB Atlas (free M0 cluster)
1. https://cloud.mongodb.com → create a project → **Create cluster** → **M0 Free**.
2. **Database Access** → add a database user (password authentication). Use a strong, generated password.
3. **Network Access** → **Add IP address** → `0.0.0.0/0` (Vercel's IP addresses change; for the course demo only).
4. **Connect** → **Drivers** → copy the connection string and add the database name before `?`:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/vms?retryWrites=true&w=majority`

### B2. Vercel
1. https://vercel.com → **Add New → Project** → import the GitHub repository.
2. Framework preset **Other**. Leave the build and output settings alone; `vercel.json` sets them.
3. **Environment Variables** (type them in Vercel; never commit them):

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | the Atlas connection string from B1 |
| `SESSION_SECRET` | a long random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CRON_SECRET` | another long random string (same command) |
| `APP_URL` | your Vercel URL, e.g. `https://<project>.vercel.app` (add after the first deploy) |
| `CORS_ORIGINS` | the same URL as `APP_URL` |
| `LOG_LEVEL` | `info` |
| `EMAIL_API_KEY`, `EMAIL_FROM` | optional: Brevo API key and a verified sender, for real arrival emails |
| `FIREBASE_*`, `VITE_FIREBASE_*` | optional: browser push (see `docs/external-api-integration.md`) |

4. **Deploy**. When it finishes, copy the URL, set `APP_URL` and `CORS_ORIGINS`, then **Redeploy**.
5. Create the demo users in Atlas from your PC (PowerShell, in the project folder):
   ```powershell
   $env:MONGODB_URI = '<Atlas connection string>'; $env:SEED_PASSWORD = '<choose a password, min 8 chars>'; npm run seed
   ```
   This creates `admin@vms.local`, `frontdesk@vms.local`, `host1@vms.local` and `host2@vms.local`, all with that password.
6. Open `https://<project>.vercel.app/api/health`. It should show `{"status":"ok"}`.

Without email or Firebase keys the app still works; arrival notifications are then recorded as **Failed** with the reason (`EMAIL_NOT_CONFIGURED`, `PUSH_NOT_CONFIGURED`). That is also useful for testing the resend and summary features.

## Part C: Manual test checklist
Use two browser windows: a normal one for **front desk** and a private/incognito one for **host1** (each has its own session). Tick each row and take screenshots as evidence.

### 1. Sign-in and security
| # | Steps | Expected |
|---|---|---|
| 1.1 | Open the site, sign in as `frontdesk@vms.local` with a wrong password | "Email or password is incorrect" |
| 1.2 | Sign in with `nobody@vms.local` and any password | Exactly the same message as 1.1 |
| 1.3 | In the incognito window, enter a wrong password for `host2@vms.local` 5 times, then the right password | 6th try: "Too many failed sign-in attempts. Try again in 15 minutes." (host2 is locked for 15 min; other users still work) |
| 1.4 | Sign in as front desk correctly. DevTools → Application → Cookies | `vms.sid` is HttpOnly, Secure, SameSite=Lax |
| 1.5 | DevTools → Network → click any `/api/...` request → Response headers | `x-frame-options: DENY`, `x-content-type-options: nosniff`, `content-security-policy`, `cache-control: no-store`, `strict-transport-security` |
| 1.6 | Sign out, then open `/visits` directly | Sent back to the sign-in page |

### 2. Visitor registration (front desk)
| # | Steps | Expected |
|---|---|---|
| 2.1 | Register visit: name `Sara Ahmed`, email `sara@example.com`, host **Host One**, purpose `Interview`, arrival = now | Visit page, status **Expected**, "Visit registered." |
| 2.2 | Register again: same name and email, same host, arrival = now | Error "already has an active visit with the same host around that time" + **Open the existing visit** link |
| 2.3 | Same visitor, host **Host Two**, arrival = tomorrow | Registered, message says **returning visitor recognised**; visit uses the same saved visitor |
| 2.4 | Register `Someone Else` with email `sara@example.com` | 409 "email or phone number already belongs to another visitor record" |
| 2.5 | Name `<script>alert(1)</script>`; then purpose `<b>x</b>` | Both refused with a clear message |
| 2.6 | Arrival date 4 months from now; arrival 1 hour in the past | "cannot be more than 90 days ahead" / "cannot be in the past" |
| 2.7 | Returning visitor lookup: search `sara` | Shows Sara with "N visits, last …" |
| 2.8 | Double-click **Register visit** quickly on a new visitor | Only one visit is created (check the Visitor log) |

### 3. Host actions (incognito, host1)
| # | Steps | Expected |
|---|---|---|
| 3.1 | Sign in as `host1@vms.local`, pre-register `Omar Ali` for tomorrow | Created; host cannot choose another host |
| 3.2 | Visitor log | Only Host One's visits are listed |
| 3.3 | Edit the visit (purpose), then cancel it | Edited; then status **Cancelled**, history shows the cancellation |
| 3.4 | Top menu | No Check-in, On site or Reports pages for hosts |

### 4. Check-in / check-out (front desk)
| # | Steps | Expected |
|---|---|---|
| 4.1 | Register a visit with arrival in 5 hours, then **Check in** | "Check-in opens 120 minutes before the expected arrival time" |
| 4.2 | Check in Sara's visit from 2.1 | Status **Checked-in**; message shows email/push notification status |
| 4.3 | Press **Check in** again on the same visit (or in a second tab) | "This visitor is already checked in" |
| 4.4 | Register Sara again for **Host Two** with arrival = now, then **Check in** that visit while she is still on site | "This visitor is already checked in on another visit; check them out first" |
| 4.5 | **On site** page | Sara is listed with time on site; page refreshes by itself every 15 s |
| 4.6 | Open Sara's visit | **Status history**: Expected → Checked-in, with who did it and when |

### 5. Host notifications
| # | Steps | Expected |
|---|---|---|
| 5.1 | Host1 → Notifications | Sara's arrival notification(s) with status (Sent, or Failed with a reason if email/push is not configured) |
| 5.2 | Front desk → Notifications | Summary at the top; "Hosts not reached" lists Sara if every channel failed |
| 5.3 | Front desk → **Resend** on a failed notification | New attempt appears ("Resend attempt"); the old one says "Already resent" and has no Resend button |
| 5.4 | Host1 → **Acknowledge** | "Arrival acknowledged"; all of Sara's notifications show Acknowledged; front desk sees "Acknowledged by host at …" on the visit |
| 5.5 | Front desk → try **Resend** again | Refused: host already acknowledged |

### 6. Check-out, log and reports
| # | Steps | Expected |
|---|---|---|
| 6.1 | Check Sara out (On site page or visit page) | Status **Checked-out**, visit length shown, history has 3 entries |
| 6.2 | Check her out again | "This visitor is already checked out" |
| 6.3 | Visitor log: filter by status, visitor name, dates | Correct rows only |
| 6.4 | **Reports** page | Totals, attendance, average visit, by host, per day, busiest hours |
| 6.5 | **Export CSV** | A CSV file downloads and opens in Excel |
| 6.6 | Host1 opens `/reports` | Not allowed (redirected) |

### 7. Docker and AWS (local, for the report)
| # | Steps | Expected |
|---|---|---|
| 7.1 | `docker compose run --rm --build test` | All tests pass |
| 7.2 | In Git Bash: `docker compose up -d --build mongo floci api`, then `bash scripts/aws/setup.sh` | Bucket and secret created |
| 7.3 | `bash scripts/aws/secrets-to-env.sh` then `docker compose up -d --force-recreate api` | `.env.docker` written; API restarted with the secrets |
| 7.4 | `bash scripts/aws/backup.sh`, then `aws --endpoint-url http://localhost:4566 s3 ls s3://vms-backups-local/mongo/vms/` | Backup file listed |
| 7.5 | `bash scripts/aws/restore.sh --yes` | "checksum verified", "Restore complete." |

If something does not match, note the step number, take a screenshot, and open DevTools → Network to copy the response's `error.code` and the `X-Request-Id` header. In Vercel → **Logs**, search for that request id to find the matching log line.
