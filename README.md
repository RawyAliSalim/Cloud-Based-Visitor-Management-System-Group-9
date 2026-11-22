# Cloud-Based-Visitor-Management-System-Group-9

Visitor Management System for the Introduction to Cloud Computing course (25CSCI37H), BUE.

| Service | Owner |
|---|---|
| Visitor Registration Service | Rawy Ali Salim |
| Check-in/Check-out and Visitor Log Service | Mostafa Raafat Mohamed |
| Host Notification Service | Mohamed Haytham |

## Stack
- Frontend: React + Vite + Tailwind CSS (`client/`)
- Backend: Node.js + Express 5, one API for all services (`server/`), deployed as a Vercel serverless function (`api/index.js`)
- Database: MongoDB Atlas with Mongoose; sessions are stored in MongoDB (`sessions` collection)
- Auth: session-based login, roles `front-desk`, `host`, `admin`
- External APIs: Brevo (email) and Firebase Cloud Messaging (browser push). See `docs/external-api-integration.md`

## Run locally
1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env` in the project root and fill in at least `MONGODB_URI`, `SESSION_SECRET` and `SEED_PASSWORD`.
3. Install dependencies:
   ```
   npm install
   npm --prefix client install
   ```
4. Create the demo users (admin, front desk, two hosts; all use `SEED_PASSWORD`):
   ```
   npm run seed
   ```
5. Start the API (port 3000) and the web app (port 5173) in two terminals:
   ```
   npm run dev
   npm run client
   ```
6. Open http://localhost:5173 and sign in, e.g. `frontdesk@vms.local` or `host1@vms.local`.

## Deploy to Vercel
1. Import the GitHub repo into Vercel. `vercel.json` builds the client into `client/dist` and routes `/api/*` to the Express app.
2. Add every variable from `.env.example` in Vercel → Settings → Environment Variables (set `NODE_ENV=production` and `APP_URL` to the Vercel URL).
3. In MongoDB Atlas → Network Access, allow Vercel to connect (e.g. `0.0.0.0/0` for the course demo).
4. Redeploy, then run `npm run seed` locally against the Atlas `MONGODB_URI` once.
5. Check `https://<project>.vercel.app/api/health` returns `{"status":"ok"}`.

## API overview
| Method | Endpoint | Roles |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout` | anyone |
| GET | `/api/auth/me`, `/api/auth/hosts` | logged in |
| POST | `/api/visits` | host (own), front-desk, admin |
| PATCH | `/api/visits/:id` | host (own), front-desk, admin |
| POST | `/api/visits/:id/cancel` | host (own), front-desk, admin |
| GET | `/api/visitors?search=` | front-desk, admin |
| GET | `/api/visits?status=&hostId=&visitor=&from=&to=` | host (own), front-desk, admin |
| GET | `/api/visits/on-site` | front-desk, admin |
| GET | `/api/visits/:id` | host (own), front-desk, admin |
| POST | `/api/visits/:id/check-in`, `/api/visits/:id/check-out` | front-desk, admin |
| GET | `/api/notifications?visitId=&hostId=&status=` | host (own), front-desk, admin |
| POST | `/api/notifications/:id/acknowledge` | host (recipient) |
| POST | `/api/notifications/:id/resend` | front-desk, admin |
| POST | `/api/notifications/fcm-token` | logged in |

Security measures (and why CORS is not one of them): see [docs/security.md](docs/security.md).

Errors always use `{ "error": { "code": "UPPER_SNAKE", "message": "..." } }`.

## Run with Docker (local development)
Docker runs MongoDB and the API locally; production still deploys to Vercel + MongoDB Atlas.
```
docker compose up -d --build                     # API on http://localhost:3000, MongoDB on 127.0.0.1:27017
docker compose exec -e SEED_PASSWORD=<min 8 chars> api npm run seed
npm --prefix client install && npm run client    # web app on http://localhost:5173 (proxies /api)
```
If a local MongoDB already uses port 27017, set `MONGO_HOST_PORT=27018` before `docker compose up`.

## AWS (Docker + AWS CLI v2)
The Docker stack includes floci, a local AWS emulator. AWS CLI v2 scripts in `scripts/aws/` keep the app secrets in **Secrets Manager** and store encrypted MongoDB backups in **S3**. See [docs/aws.md](docs/aws.md).

## Testing
Automated integration tests use Node's built-in test runner against a real MongoDB. Each test file creates and drops its own `vms_test_*` database.
```
docker compose run --rm --build test             # everything inside Docker
npm test                                         # or locally, with TEST_MONGODB_URI=mongodb://127.0.0.1:27017
```
Tests refuse to run against a `mongodb+srv://` (Atlas) URI.

Logs are one JSON line per event (`http.request`, `visit.checked_in`, ...). Every response carries an `X-Request-Id` header that appears in the matching log line. Set `LOG_LEVEL` to `debug`, `info`, `warn`, `error` or `silent`.

Deployment steps and the manual test checklist: [docs/deployment-and-manual-testing.md](docs/deployment-and-manual-testing.md).

Manual API tests: import `tests/postman/visitor-management.postman_collection.json` into Postman, set `baseUrl` and `password`, then run the folders in order: Auth, Visitor Registration, Check-in and Visitor Log, Notifications.
