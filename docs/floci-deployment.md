# Deployment on floci (AWS emulator)

The required deployment for this module is on **floci**, an open-source AWS emulator that runs in Docker. Everything is created with **AWS CLI v2** by `scripts/floci/*.sh`. The Vercel deployment still works but is the "minimum" option.

## Architecture

```
Browser ──► S3 static website  vms-web          (React app)
   │
   └──► API Gateway (HTTP API) vmsapi ──┬──► Lambda vms-registration  (Rawy)    ──┐
                                        ├──► Lambda vms-checkin       (Mostafa) ──┼──► MongoDB (Atlas, or local Docker MongoDB)
                                        └──► Lambda vms-notifications (Mohamed) ──┘──► Brevo (email API)
   Each Lambda: own IAM role, own CloudWatch log group /aws/lambda/vms-<service>
   vms-checkin also writes every exported CSV report to S3 bucket vms-reports
   Code package: S3 bucket vms-deploy-artifacts    Secrets: Secrets Manager vms/floci/app-config
```

- **One code package, three functions.** `api/lambda.js` starts the Express app with only the routes of the service named in `VMS_SERVICE` (`server/app.js` → `createApp({ services })`). A Lambda for one service cannot serve another service's routes.
- **API Gateway** has one route per endpoint and sends each to the Lambda that owns it (`scripts/floci/services/<service>.sh`).
- **Shared session:** all three Lambdas use the same session store in MongoDB, so one sign-in works across services.
- **Website and API are different hosts** (`vms-web.s3-website…` and `vmsapi.execute-api…`, both under `localhost.floci.io`). CORS allows only the website, and cookies work because both are the same site. On HTTP the cookie can't be `Secure`, so `SESSION_COOKIE_SECURE=false` is set for floci only.

## AWS services per student

| Student / service | AWS services used by that service |
|---|---|
| Rawy, Visitor Registration (and sign-in) | Lambda `vms-registration`, API Gateway routes (visits create/edit/cancel, visitors, auth), IAM role `vms-registration-role`, CloudWatch Logs, **Secrets Manager**: every function reads the database string, session secret and email key from `vms/floci/app-config` when it starts; the functions' environment variables hold only the secret's name, and each IAM role may read only that one secret (`server/lambda/init.js`) |
| Mostafa, Check-in/Check-out & Visitor Log | Lambda `vms-checkin`, API Gateway routes (log, on-site, check-in/out, reports), IAM role `vms-checkin-role` (may only add files under `reports/`), CloudWatch Logs, **S3 `vms-reports`** (private, AES-256, 365-day expiry; every CSV export is archived, `X-Report-Archive` header) |
| Mohamed, Host Notifications | Lambda `vms-notifications`, API Gateway routes (`/api/notifications…`), IAM role `vms-notifications-role`, CloudWatch Logs |
| Shared (deployment) | S3 `vms-web` (public website, the only public bucket) and `vms-deploy-artifacts` (code) |

## Run it

Requirements: Docker Desktop, AWS CLI v2, Node.js, Git Bash (on Windows). On an 8 GB laptop, close other apps first; floci keeps at most 6 warm Lambda containers.

```bash
export MONGO_HOST_PORT=27018                  # only if a local MongoDB already uses 27017
docker compose up -d floci mongo              # floci (with Docker access for Lambda) + local MongoDB
bash scripts/floci/configure.sh               # secrets -> Secrets Manager (asks for DB string and optional Brevo key; input hidden)
bash scripts/floci/deploy.sh                  # build, upload, create/update everything (first run ~5 min)
bash scripts/floci/smoke-test.sh              # checks website, each Lambda via API Gateway, CORS, resources
```

Then open **http://vms-web.s3-website.localhost.floci.io:4566**. Always start from that address; deep links like `/visits` are served with a 404 status by the S3 website (the app still loads).

- **Database:** press Enter in `configure.sh` to use the local Docker MongoDB (`mongodb://mongo:27017/vms`), or paste the Atlas connection string to use the same data as the Vercel site. Create users in the local database with `MONGODB_URI=mongodb://127.0.0.1:27018/vms SEED_PASSWORD=... npm run seed`.
- **Email:** give the Brevo API key and verified sender in `configure.sh`, then run `deploy.sh` again.
- **floci does not keep its state after a restart.** After restarting Docker, run `configure.sh` and `deploy.sh` again.

## Evidence commands (AWS CLI v2)

```bash
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test MSYS_NO_PATHCONV=1
aws lambda list-functions --query 'Functions[].[FunctionName,Runtime,Role]' --output table
aws apigatewayv2 get-routes --api-id vmsapi --query 'Items[].RouteKey' --output table
aws iam get-role-policy --role-name vms-checkin-role --policy-name vms-checkin-policy
aws logs tail /aws/lambda/vms-checkin --since 10m
aws s3 ls s3://vms-reports/reports/ --recursive
aws secretsmanager describe-secret --secret-id vms/floci/app-config
aws lambda get-function-configuration --function-name vms-registration --query 'keys(Environment.Variables)'   # no secrets, only VMS_SECRET_ID
```

The floci dashboard (`docker compose --profile ui up -d floci-dash`, http://localhost:8080) shows the same resources in a browser.

## Troubleshooting
- `Docker is not reachable` when a Lambda runs: floci was started without the Docker socket. Use `docker compose up -d floci` from this repository.
- `Invalid logGroupName` in Git Bash: run the scripts as shown (they set `MSYS_NO_PATHCONV=1`); typing `/aws/...` arguments by hand needs the same variable.
- First request to each Lambda is slow (cold start, about 5–20 s); the first ever deploy also downloads the Lambda Node.js image (about 2 minutes).
