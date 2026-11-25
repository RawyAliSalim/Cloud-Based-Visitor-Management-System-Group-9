// AWS Lambda entry point (used by the floci deployment, see docs/floci-deployment.md).
// One code package, three functions: VMS_SERVICE says which service this function runs
// (registration, checkin or notifications), so each Lambda only serves its own routes.
const serverless = require('serverless-http');
const init = require('../server/lambda/init');
const events = require('../server/lambda/events');

let httpHandlerPromise = null;

// Built once per Lambda container (cold start) and reused by later invocations.
function getHttpHandler() {
  if (!httpHandlerPromise) {
    httpHandlerPromise = (async () => {
      await init.beforeStart();
      const { createApp } = require('../server/app');
      const services = (process.env.VMS_SERVICE || 'registration,checkin,notifications')
        .split(',')
        .map((service) => service.trim())
        .filter(Boolean);
      return serverless(createApp({ services }));
    })().catch((error) => {
      httpHandlerPromise = null;
      throw error;
    });
  }
  return httpHandlerPromise;
}

function isHttpEvent(event) {
  return Boolean(event && (event.requestContext || event.httpMethod || event.rawPath));
}

exports.handler = async (event, context) => {
  // Keep the MongoDB connection open between invocations instead of waiting for it to close.
  context.callbackWaitsForEmptyEventLoop = false;
  if (isHttpEvent(event)) {
    const handler = await getHttpHandler();
    return handler(event, context);
  }
  await init.beforeStart();
  return events.handle(event, context);
};
