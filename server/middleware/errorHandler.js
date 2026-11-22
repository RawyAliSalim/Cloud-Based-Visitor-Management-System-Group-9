const { sendError } = require('./validate');
const logger = require('../utils/logger');

function notFound(req, res) {
  return sendError(res, 404, 'NOT_FOUND', 'Route not found');
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  }

  if (error.type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }

  if (error.name === 'ValidationError') {
    const first = Object.values(error.errors || {})[0];
    return sendError(res, 400, 'VALIDATION_ERROR', first ? first.message : 'Invalid data');
  }

  if (error.name === 'CastError') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid value');
  }

  if (error.code === 11000) {
    return sendError(res, 409, 'DUPLICATE_RECORD', 'Record already exists');
  }

  logger.error('http.unhandled_error', {
    requestId: req.id,
    error: error.name,
    detail: process.env.NODE_ENV === 'production' ? undefined : error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
  });

  return sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
}

module.exports = { notFound, errorHandler };
