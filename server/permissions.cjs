// Authorization rules applied to claims from an already-validated token.
// Signature, issuer, audience, and expiry are checked by checkJwt in auth.cjs
// before any of these functions run.

const ROLE_CLAIM = "https://reservehub-api/role";

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function scopesOf(payload) {
  return new Set(
    typeof payload?.scope === "string"
      ? payload.scope.split(" ").filter(Boolean)
      : []
  );
}

function hasScope(payload, scope) {
  return scopesOf(payload).has(scope);
}

function isScheduler(payload) {
  return payload?.[ROLE_CLAIM] === "scheduler";
}

// The audited identity: issuer + subject from the validated token.
function actorOf(payload) {
  const iss = payload?.iss;
  const sub = payload?.sub;

  if (typeof iss !== "string" || typeof sub !== "string") {
    throw httpError(401, "A user token is required.");
  }

  return JSON.stringify({ issuer: iss, subject: sub });
}

// Throws a 401/403 error unless the token has the scope (and the scheduler
// role when required). Returns the actor identity on success.
function authorize(payload, scope, requireSchedulerRole = false) {
  const identity = actorOf(payload);

  if (!hasScope(payload, scope)) {
    throw httpError(403, `Required permission: ${scope}.`);
  }

  if (requireSchedulerRole && !isScheduler(payload)) {
    throw httpError(403, "A scheduler account is required.");
  }

  return identity;
}

// Express middleware: run after checkJwt and requiredScopes.
function requireScheduler(req, res, next) {
  if (!isScheduler(req.auth?.payload)) {
    return res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Only schedulers can manage reservations.",
      },
    });
  }

  next();
}

module.exports = {
  ROLE_CLAIM,
  scopesOf,
  hasScope,
  isScheduler,
  actorOf,
  authorize,
  requireScheduler,
};
