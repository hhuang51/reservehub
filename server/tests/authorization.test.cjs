// Authorization rules applied to claims from a validated token.
// (Signature, issuer, audience, and expiry are verified earlier by checkJwt.)
//
// Hand-predicted outcomes:
//   read-only token  + read tool            -> allowed
//   read-only token  + write tool           -> 403 missing write scope
//   write scope, role "viewer"              -> 403 scheduler required
//   scheduler role, no write scope          -> 403 missing write scope
//   scheduler + write scope                 -> allowed
//   token without sub                       -> 401
//   look-alike scope "read:reservations-x"  -> does not count

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ROLE_CLAIM,
  authorize,
  hasScope,
  requireScheduler,
} = require("../permissions.cjs");

const base = { iss: "https://example.auth0.com/", sub: "auth0|student" };

const readOnly = { ...base, scope: "openid read:reservations" };
const viewerWithWrite = {
  ...base,
  scope: "openid read:reservations write:reservations",
  [ROLE_CLAIM]: "viewer",
};
const schedulerNoWrite = {
  ...base,
  scope: "openid read:reservations",
  [ROLE_CLAIM]: "scheduler",
};
const scheduler = {
  ...base,
  scope: "openid read:reservations write:reservations",
  [ROLE_CLAIM]: "scheduler",
};

function expectStatus(fn, status, message) {
  assert.throws(fn, (error) => {
    assert.equal(error.status, status);
    if (message) assert.equal(error.message, message);
    return true;
  });
}

test("read-only token can use read tools and gets the audited actor", () => {
  assert.equal(
    authorize(readOnly, "read:reservations"),
    JSON.stringify({ issuer: base.iss, subject: base.sub })
  );
});

test("read-only token cannot execute a write (e.g. create_reservation)", () => {
  expectStatus(
    () => authorize(readOnly, "write:reservations", true),
    403,
    "Required permission: write:reservations."
  );
});

test("write scope without the scheduler role is rejected", () => {
  expectStatus(
    () => authorize(viewerWithWrite, "write:reservations", true),
    403,
    "A scheduler account is required."
  );
});

test("scheduler role without the write scope is rejected", () => {
  expectStatus(
    () => authorize(schedulerNoWrite, "write:reservations", true),
    403,
    "Required permission: write:reservations."
  );
});

test("scheduler with write scope is allowed", () => {
  assert.doesNotThrow(() => authorize(scheduler, "write:reservations", true));
});

test("a token without issuer/subject is rejected with 401", () => {
  expectStatus(
    () => authorize({ scope: "read:reservations" }, "read:reservations"),
    401
  );
  expectStatus(
    () => authorize({ ...readOnly, sub: 123 }, "read:reservations"),
    401
  );
});

test("scopes match whole words only", () => {
  assert.equal(hasScope({ scope: "read:reservations-admin" }, "read:reservations"), false);
  assert.equal(hasScope({ scope: "xread:reservations" }, "read:reservations"), false);
  assert.equal(hasScope({ scope: "a  read:reservations" }, "read:reservations"), true);
  // Scopes must be a space-separated string, as issued by Auth0.
  assert.equal(hasScope({ scope: ["read:reservations"] }, "read:reservations"), false);
  assert.equal(hasScope(undefined, "read:reservations"), false);
});

function runMiddleware(payload) {
  const result = { status: null, body: null, nextCalled: false };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };

  requireScheduler({ auth: payload ? { payload } : undefined }, res, () => {
    result.nextCalled = true;
  });

  return result;
}

test("requireScheduler middleware passes schedulers through", () => {
  const result = runMiddleware(scheduler);
  assert.equal(result.nextCalled, true);
  assert.equal(result.status, null);
});

test("requireScheduler returns the standard 403 JSON error shape", () => {
  for (const payload of [readOnly, viewerWithWrite, undefined]) {
    const result = runMiddleware(payload);
    assert.equal(result.nextCalled, false);
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, {
      error: {
        code: "FORBIDDEN",
        message: "Only schedulers can manage reservations.",
      },
    });
  }
});

test("a role claim under a different name does not count", () => {
  const result = runMiddleware({ ...readOnly, role: "scheduler" });
  assert.equal(result.status, 403);
});
