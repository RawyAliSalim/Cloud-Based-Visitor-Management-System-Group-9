const { getFirebaseMessaging } = require('../config/firebase');

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

async function sendPush({ tokens, title, body, data, link }) {
  const messaging = getFirebaseMessaging();

  if (!messaging) {
    throw new Error('PUSH_NOT_CONFIGURED');
  }

  const uniqueTokens = [...new Set((tokens || []).filter(Boolean))];

  if (uniqueTokens.length === 0) {
    throw new Error('NO_PUSH_TOKEN');
  }

  const message = {
    tokens: uniqueTokens,
    notification: { title, body },
    data: data || {}
  };

  if (link) {
    message.webpush = { fcmOptions: { link } };
  }

  const result = await messaging.sendEachForMulticast(message);
  const invalidTokens = [];
  let errorCode = null;

  result.responses.forEach((response, index) => {
    if (response.success) {
      return;
    }

    const code = response.error && response.error.code;
    errorCode = errorCode || code || 'PUSH_DELIVERY_FAILED';

    if (INVALID_TOKEN_CODES.has(code)) {
      invalidTokens.push(uniqueTokens[index]);
    }
  });

  return {
    successCount: result.successCount,
    failureCount: result.failureCount,
    invalidTokens,
    errorCode
  };
}

module.exports = { sendPush };
