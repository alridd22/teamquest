// netlify/functions/retry_all_ai_cron.js

const BASE_URL =
  process.env.URL || "https://theteamquest.netlify.app"; // adjust if needed

async function callRetry(path, payload) {
  const url = `${BASE_URL}${path}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));

    return {
      path,
      status: res.status,
      ok: res.ok,
      retried: json.retried ?? null,
      details: json,
    };
  } catch (e) {
    return {
      path,
      status: 0,
      ok: false,
      error: e && e.message ? e.message : String(e),
    };
  }
}

exports.handler = async () => {
  const payload = {
    maxAgeSeconds: 120,
    maxAttempts: 3,
    limit: 50,
  };

  const paths = [
    "/.netlify/functions/retry_scavenger_ai_function",
    "/.netlify/functions/retry_kindness_ai_function",
    "/.netlify/functions/retry_limerick_ai_function",
  ];

  const results = [];
  for (const p of paths) {
    const r = await callRetry(p, payload);
    results.push(r);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, ran: paths.length, results }),
  };
};

// Run every 3 minutes
exports.config = {
  schedule: "*/3 * * * *",
};
