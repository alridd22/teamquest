// /netlify/functions/_lib/auth.js
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.TQ_JWT_SECRET;

function signTeamToken({ teamCode, teamName, eventId, device }) {
  if (!JWT_SECRET) throw new Error("Missing TQ_JWT_SECRET");
  const payload = { teamCode, teamName, eventId, device };
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "12h",
    audience: "teamquest",
    issuer: "teamquest"
  });
}

function verifyTeamToken(token) {
  if (!JWT_SECRET) throw new Error("Missing TQ_JWT_SECRET");
  return jwt.verify(token, JWT_SECRET, {
    audience: "teamquest",
    issuer: "teamquest"
  });
}

module.exports = { signTeamToken, verifyTeamToken };
