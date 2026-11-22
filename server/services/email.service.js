const DEFAULT_EMAIL_API_URL = 'https://api.brevo.com/v3/smtp/email';
const EMAIL_TIMEOUT_MS = 5000;

function isEmailConfigured() {
  return Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
}

// EMAIL_API_URL can point at a local fake provider in automated tests.
function emailApiUrl() {
  return process.env.EMAIL_API_URL || DEFAULT_EMAIL_API_URL;
}

async function sendEmail({ to, subject, text, html }) {
  if (!isEmailConfigured()) {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }

  if (!to) {
    throw new Error('HOST_EMAIL_MISSING');
  }

  let response;
  try {
    response = await fetch(emailApiUrl(), {
      method: 'POST',
      headers: {
        'api-key': process.env.EMAIL_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        sender: { email: process.env.EMAIL_FROM, name: 'Visitor Management System' },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html
      }),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS)
    });
  } catch (error) {
    throw new Error(error && error.name === 'TimeoutError' ? 'EMAIL_TIMEOUT' : 'EMAIL_NETWORK_ERROR');
  }

  if (!response.ok) {
    throw new Error(`EMAIL_PROVIDER_ERROR_${response.status}`);
  }

  return true;
}

module.exports = { isEmailConfigured, sendEmail };
