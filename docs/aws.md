# AWS (Docker + AWS CLI v2, via floci)

The project uses **AWS CLI v2** against **floci**, an open-source AWS emulator that runs in Docker (`docker compose` service `floci`, port 4566). Everything runs locally, so there is no AWS bill and no real account is needed. The same scripts work on real AWS by setting `AWS_ENDPOINT_URL` to the real endpoint and `ALLOW_REAL_AWS=true`. Without that flag they refuse to run against anything that isn't local.

Production still runs on Vercel and MongoDB Atlas. AWS is used for **secret management** and **database backups** in the Docker environment.

| AWS service | What we use it for | Security settings |
|---|---|---|
| Secrets Manager | Holds the app secrets (`SESSION_SECRET`, `SEED_PASSWORD`, `CRON_SECRET`, plus email/Firebase keys if they are in `.env`). The API container gets them via `.env.docker`, so no secret is written into `docker-compose.yml` or the code. | Values are never printed; `.env.docker` is git-ignored; rotation keeps the previous version (`AWSPREVIOUS`). |
| S3 | Stores compressed MongoDB backups (`mongo/vms/vms-<UTC time>.archive.gz`) | Public access blocked, AES-256 encryption, versioning, backups expire after 30 days, SHA-256 checksum in object metadata checked before restore |

## Requirements
- Docker Desktop
- AWS CLI v2 (`aws --version` must show `aws-cli/2.x`)
- Node.js (used by the scripts to handle JSON safely)
- A Bash shell. On Windows, use **Git Bash**.

## Steps
```bash
docker compose up -d --build mongo floci api   # MongoDB, floci (AWS) and the API
bash scripts/aws/setup.sh                      # create the S3 bucket + Secrets Manager secret (safe to repeat)
bash scripts/aws/secrets-to-env.sh             # read the secret -> .env.docker
docker compose up -d --force-recreate api      # API now runs with the secrets from Secrets Manager
docker compose exec api npm run seed           # demo users; password = SEED_PASSWORD from the secret
bash scripts/aws/backup.sh                     # mongodump -> s3://vms-backups-local/mongo/vms/...
bash scripts/aws/restore.sh --yes              # newest backup -> MongoDB (checksum verified first)
bash scripts/aws/rotate-session-secret.sh      # new SESSION_SECRET (signs everyone out after restart)
```

To see the seed password without echoing it in logs, run it on your own machine:
```bash
aws --endpoint-url http://localhost:4566 secretsmanager get-secret-value --secret-id vms/local/app-config --query SecretString --output text
```

## Useful AWS CLI v2 commands (for evidence screenshots)
```bash
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
aws s3 ls
aws s3 ls s3://vms-backups-local/mongo/vms/
aws s3api get-bucket-encryption --bucket vms-backups-local
aws s3api get-public-access-block --bucket vms-backups-local
aws s3api get-bucket-versioning --bucket vms-backups-local
aws secretsmanager describe-secret --secret-id vms/local/app-config
aws secretsmanager list-secret-version-ids --secret-id vms/local/app-config
```
If your machine has the `floci` profile (`~/.aws/config` with `endpoint_url = http://localhost:4566`), `AWS_PROFILE=floci aws ...` works too.

## Settings
`VMS_BACKUP_BUCKET` (default `vms-backups-local`), `VMS_SECRET_ID` (default `vms/local/app-config`), `FLOCI_HOST_PORT` (default 4566), `AWS_ENDPOINT_URL`, `AWS_REGION`.
