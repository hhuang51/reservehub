// Which IP address identifies the visitor (used for per-IP rate limits).
//
// On Render, every request arrives through Cloudflare and Render's load
// balancers, so the TCP peer and the last X-Forwarded-For hop are proxies,
// and Cloudflare's addresses change from request to request. Cloudflare sets
// CF-Connecting-IP to the real client address and overwrites any value the
// client sent, and Render services cannot be reached except through that
// edge, so on Render the header is trustworthy.
//
// Anywhere else (local development) the header could be forged by the
// caller, so it is ignored and the connection address is used.

const net = require("node:net");

function clientIp(req, onRender = process.env.RENDER === "true") {
  if (onRender) {
    const header = req.headers?.["cf-connecting-ip"];
    const value = typeof header === "string" ? header.trim() : "";

    if (net.isIP(value)) return value;
  }

  return req.ip || req.socket?.remoteAddress || "unknown";
}

module.exports = { clientIp };
