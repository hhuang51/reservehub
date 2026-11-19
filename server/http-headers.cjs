function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  // The API only returns JSON and event streams; it never needs to run
  // scripts, load resources, or be framed.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'"
  );
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  // HSTS only where the API is served over HTTPS (Render sets RENDER=true).
  if (process.env.RENDER === "true") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }

  res.removeHeader("X-Powered-By");
  next();
}

function defaultCachePolicy(req, res, next) {
  if (req.headers.authorization) {
    res.setHeader("Cache-Control", "private, no-store");
  } else {
    res.setHeader("Cache-Control", "no-store");
  }

  // Responses differ by Origin (CORS) and by token.
  res.vary("Origin");
  res.vary("Authorization");
  next();
}

// Public, non-personalized reads (rooms, schedules, closures). Shared caches
// may store them, but every use must revalidate (ETag -> 304), so a live
// update is never answered with stale data.
function publicRevalidate(res) {
  res.setHeader("Cache-Control", "public, no-cache");
}

// Public data that changes rarely (the holiday list).
function publicFor(res, seconds) {
  res.setHeader(
    "Cache-Control",
    `public, max-age=${seconds}, s-maxage=${seconds}`
  );
}

module.exports = {
  securityHeaders,
  defaultCachePolicy,
  publicRevalidate,
  publicFor,
};
