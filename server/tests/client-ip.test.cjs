// Client IP used for rate limiting. Hand-predicted:
//   on Render, valid CF-Connecting-IP         -> that address
//   on Render, missing/garbage header          -> connection address
//   locally, any CF-Connecting-IP              -> ignored (could be forged)

const test = require("node:test");
const assert = require("node:assert/strict");
const { clientIp } = require("../client-ip.cjs");

function req(headers = {}, ip = "10.0.0.7") {
  return { headers, ip, socket: { remoteAddress: ip } };
}

test("on Render, the Cloudflare client IP is used", () => {
  assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9" }), true), "203.0.113.9");
  assert.equal(clientIp(req({ "cf-connecting-ip": " 2001:db8::1 " }), true), "2001:db8::1");
});

test("on Render, a missing or invalid header falls back to the connection", () => {
  assert.equal(clientIp(req(), true), "10.0.0.7");
  assert.equal(clientIp(req({ "cf-connecting-ip": "not-an-ip" }), true), "10.0.0.7");
  assert.equal(clientIp(req({ "cf-connecting-ip": "1.2.3.4, 5.6.7.8" }), true), "10.0.0.7");
});

test("locally, the header is ignored so it cannot be forged", () => {
  assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9" }), false), "10.0.0.7");
});

test("different Cloudflare edge addresses still map to one visitor", () => {
  const a = req({ "cf-connecting-ip": "198.51.100.4" }, "172.68.1.1");
  const b = req({ "cf-connecting-ip": "198.51.100.4" }, "172.70.9.9");
  assert.equal(clientIp(a, true), clientIp(b, true));
});
