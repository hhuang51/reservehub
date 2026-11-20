// Deliberate, switchable failures for the SLO alert demonstration and
// Game Day (D10, S2). Never active in production.
//
// Set FAULT_ERROR_RATE on the STAGING API (Render -> Environment), e.g. 0.5,
// and about half of public room and schedule reads return 503. Set it back to
// 0 to stop. The setting is read on every request, but changing an
// environment variable in Render restarts the service anyway.

function faultRate(env = process.env) {
  if (env.APP_ENV === "production") return 0;

  const rate = Number(env.FAULT_ERROR_RATE);
  if (!Number.isFinite(rate) || rate <= 0) return 0;

  return Math.min(rate, 1);
}

function shouldInjectFault(env = process.env, random = Math.random) {
  const rate = faultRate(env);
  return rate > 0 && random() < rate;
}

function createFaultInjection(log = () => {}) {
  return function faultInjection(req, res, next) {
    if (!shouldInjectFault()) return next();

    log("warn", "injected fault", { path: req.path, rate: faultRate() });

    return res.status(503).json({
      error: {
        code: "INJECTED_FAULT",
        message: "Temporary failure (fault injection test). Please retry.",
      },
    });
  };
}

module.exports = { faultRate, shouldInjectFault, createFaultInjection };
