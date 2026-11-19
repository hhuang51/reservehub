const { rateLimit } = require("express-rate-limit");

// Limits are per client IP, per minute. Set TRUST_PROXY=1 on Render so
// req.ip is the visitor's address rather than Render's proxy.
// The counters live in memory, which is fine for one instance; several
// instances would need a shared store such as Redis.

const MINUTE = 60 * 1000;

function limitFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// MCP tools reach the REST API over loopback. Those requests are already
// counted by mcpLimiter, so the write limiter skips them. Anything that
// came through Render's proxy carries X-Forwarded-For and is never skipped.
function isInternalMcpRequest(req) {
  const address = req.socket.remoteAddress;
  const loopback =
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1";

  return (
    loopback &&
    req.get("X-Internal-Request") === "mcp" &&
    req.get("X-Forwarded-For") === undefined
  );
}

function limiter(name, limit, skip) {
  return rateLimit({
    windowMs: MINUTE,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip,
    handler: (req, res, next, options) => {
      console.warn(`Rate limit reached: ${name} ${req.method} ${req.path}`);

      res.status(options.statusCode).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Wait a minute and try again.",
        },
      });
    },
  });
}

const writeLimiter = limiter(
  "writes",
  limitFromEnv("RATE_LIMIT_WRITES_PER_MINUTE", 20),
  isInternalMcpRequest
);

// One MCP tool call is about three HTTP requests (initialize,
// initialized notification, tools/call), so 60 is roughly 20 tool calls.
const mcpLimiter = limiter(
  "mcp",
  limitFromEnv("RATE_LIMIT_MCP_PER_MINUTE", 60)
);

const holidayLimiter = limiter(
  "holidays",
  limitFromEnv("RATE_LIMIT_HOLIDAYS_PER_MINUTE", 30)
);

// Apply a limiter to POST/PATCH/PUT/DELETE only; public reads pass through.
function onlyWrites(middleware) {
  return (req, res, next) =>
    req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS"
      ? next()
      : middleware(req, res, next);
}

module.exports = {
  writeLimiter,
  mcpLimiter,
  holidayLimiter,
  onlyWrites,
  isInternalMcpRequest,
};
