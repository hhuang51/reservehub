const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const {
  auth,
  requiredScopes,
} = require("express-oauth2-jwt-bearer");
const { requireScheduler } = require("./permissions.cjs");

if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE) {
  throw new Error("Missing Auth0 settings in server/.env");
}

const checkJwt = auth({
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}/`,
  audience: process.env.AUTH0_AUDIENCE,
  tokenSigningAlg: "RS256",
});

const checkReadReservations = requiredScopes("read:reservations");
const checkWriteReservations = requiredScopes("write:reservations");

module.exports = {
  checkJwt,
  checkReadReservations,
  checkWriteReservations,
  requireScheduler,
};