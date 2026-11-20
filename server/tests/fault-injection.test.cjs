// Fault injection must never fire in production. Hand-predicted:
//   production, any rate        -> never
//   staging, unset/0/garbage    -> never
//   staging, 0.5, random 0.49   -> fault; random 0.5 -> no fault
//   staging, 7                  -> clamped to 1 (always)

const test = require("node:test");
const assert = require("node:assert/strict");
const { faultRate, shouldInjectFault } = require("../fault-injection.cjs");

test("never active in production", () => {
  const env = { APP_ENV: "production", FAULT_ERROR_RATE: "1" };
  assert.equal(faultRate(env), 0);
  assert.equal(shouldInjectFault(env, () => 0), false);
});

test("off unless a positive rate is set", () => {
  for (const value of [undefined, "", "0", "-1", "abc"]) {
    assert.equal(faultRate({ APP_ENV: "staging", FAULT_ERROR_RATE: value }), 0);
  }
});

test("staging rate decides by the random draw", () => {
  const env = { APP_ENV: "staging", FAULT_ERROR_RATE: "0.5" };
  assert.equal(shouldInjectFault(env, () => 0.49), true);
  assert.equal(shouldInjectFault(env, () => 0.5), false);
});

test("rates above 1 are clamped", () => {
  assert.equal(faultRate({ APP_ENV: "staging", FAULT_ERROR_RATE: "7" }), 1);
});
