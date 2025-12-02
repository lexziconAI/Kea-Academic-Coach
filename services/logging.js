/**
 * Logging utility with levels including log3/log4 for verbose tracing
 */
const LEVELS = {
  error: 0,
  info: 1,
  debug: 2,
  log3: 3,
  log4: 4
};

const DEFAULT = process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) : LEVELS.debug;

function timestamp() {
  return new Date().toISOString();
}

function log(level, ...args) {
  const numeric = typeof level === 'string' ? LEVELS[level] ?? LEVELS.info : level;
  if (numeric > DEFAULT) return;
  const label = Object.keys(LEVELS).find(k => LEVELS[k] === numeric) || numeric;
  console.log(`[${timestamp()}] [${label.toUpperCase()}]`, ...args);
}

module.exports = { LEVELS, log };
