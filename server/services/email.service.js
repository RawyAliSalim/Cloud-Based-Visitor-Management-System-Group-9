const EMAIL_API_URL = 'https://api.brevo.com/v3/smtp/email';
const EMAIL_TIMEOUT_MS = 5000;

function isEmailConfigured() {
  return Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
}

async function sendEmail({ to, subject, text, html }) {
  if (!isEmailConfigured()) {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }

  if (!to) {
    throw new Error('HOST_EMAIL_MISSING');
  }

  const response = await fetch(EMAIL_API_URL, {
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

  if (!response.ok) {
    throw new Error(`EMAIL_PROVIDER_ERROR_${response.status}`);
  }

  return true;
}

module.exports = { isEmailConfigured, sendEmail };
