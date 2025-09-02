// _lib/http.js
const ok = (body) => ({ statusCode: 200, body: JSON.stringify({ success: true, ...body }) });
const bad = (status, message) => ({ statusCode: status, body: JSON.stringify({ success: false, message }) });

function requireAdmin(event) {
  const token = event.headers["x-tq-admin"] || event.headers["X-Tq-Admin"] || event.headers["x-TQ-Admin"];
  if (!token || token !== process.env.TQ_ADMIN_TOKEN) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
}

function getBody(event) {
  try { return event.body ? JSON.parse(event.body) : {}; } catch { return {}; }
}

module.exports = { ok, bad, requireAdmin, getBody };
