// _lib/http.js

// Standard JSON helpers
const ok  = (body) => ({
  statusCode: 200,
  body: JSON.stringify({ success: true, ...body })
});

const bad = (status, message) => ({
  statusCode: status,
  body: JSON.stringify({ success: false, message })
});

// ---- AUTH DISABLED (Option B) ----
// We leave the function in-place so existing code that calls `requireAdmin(event)`
// still works, but it never blocks any request.
function requireAdmin(event) {
  return true; // no-op
}

// Safe JSON body parser
function getBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
}

module.exports = { ok, bad, requireAdmin, getBody };
