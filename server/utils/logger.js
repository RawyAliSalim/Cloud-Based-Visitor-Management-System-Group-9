// Structured JSON logger shared by all services.
// One line per event so Vercel / Docker logs can be filtered by "event".
// Never pass passwords, tokens, session ids or visitor contact details here.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const REDACTED_KEYS = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|email|phone/i;

function threshold() {
  const configured = (process.env.LOG_LEVEL || '').toLowerCase();
  if (LEVELS[configured] !== undefined) {
    return LEVELS[configured];
  }
  return process.env.NODE_ENV === 'test' ? LEVELS.silent : LEVELS.info;
}

function redact(fields) {
  const clean = {};
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    if (REDACTED_KEYS.test(key)) {
      clean[key] = '[redacted]';
    } else if (value instanceof Error) {
      clean[key] = value.message;
    } else {
      clean[key] = value;
    }
  });
  return clean;
}

function write(level, event, fields) {
  if (LEVELS[level] < threshold()) {
    return;
  }
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...redact(fields) });
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  debug: (event, fields) => write('debug', event, fields),
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields)
};
