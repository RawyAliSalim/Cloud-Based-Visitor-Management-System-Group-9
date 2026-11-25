// Runs once when a Lambda container starts, before the app is built.
//
// Secrets (database connection string, session secret, email API key) are NOT stored in the
// Lambda's environment variables, where anyone allowed to read the function configuration could
// see them. The function only gets the secret's name (VMS_SECRET_ID); its IAM role is allowed to
// read exactly that secret from AWS Secrets Manager, and the values are loaded here.
const logger = require('../utils/logger');

const ALLOWED_KEYS = new Set(['MONGODB_URI', 'SESSION_SECRET', 'CRON_SECRET', 'EMAIL_API_KEY', 'EMAIL_FROM']);

let loaded = null;

async function fetchSecret(secretId) {
  // The AWS SDK v3 is part of the Lambda Node.js runtime, so it is not a project dependency.
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const result = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
  return JSON.parse(result.SecretString || '{}');
}

// Copies the allowed keys into process.env. Only known keys are accepted, so a secret cannot
// change unrelated settings (for example NODE_ENV) of the function.
function applySecret(values) {
  const applied = [];
  for (const [key, value] of Object.entries(values)) {
    if (ALLOWED_KEYS.has(key) && typeof value === 'string' && value !== '') {
      process.env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}

async function beforeStart({ fetch = fetchSecret } = {}) {
  const secretId = process.env.VMS_SECRET_ID;
  if (!secretId) {
    return;
  }
  if (!loaded) {
    loaded = (async () => {
      const keys = applySecret(await fetch(secretId));
      if (!process.env.MONGODB_URI || !process.env.SESSION_SECRET) {
        throw new Error(`Secret ${secretId} must contain MONGODB_URI and SESSION_SECRET`);
      }
      logger.info('lambda.secrets_loaded', { secretId, keys: keys.join(',') });
    })().catch((error) => {
      loaded = null; // try again on the next invocation
      logger.error('lambda.secrets_failed', { secretId, error: error.message });
      throw error;
    });
  }
  await loaded;
}

function resetForTests() {
  loaded = null;
}

module.exports = { beforeStart, applySecret, resetForTests, ALLOWED_KEYS };
