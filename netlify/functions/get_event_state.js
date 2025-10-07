// get_event_state.js
const { ok, bad } = require("./_lib/http");
const { getEventById } = require("./_lib/sheets");

function normState(s = "") {
  const v = String(s).trim().toUpperCase();
  if (["RUNNING", "STARTED", "ACTIVE"].includes(v)) return "running";
  if (["PAUSED", "PAUSE"].includes(v)) return "paused";
  if (["ENDED", "END", "STOPPED", "FINISHED", "COMPLETE", "COMPLETED"].includes(v)) return "ended";
  if (["PUBLISHED"].includes(v)) return "published";
  if (["NOT_STARTED", "NOTSTARTED", "READY", "PENDING", "DRAFT", ""].includes(v)) return "notstarted";
  return "notstarted";
}

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const eventId = url.searchParams.get("eventId") || "EVT-19-08-2025";

    const row = await getEventById(eventId);
    if (!row) return bad(404, "Event not found");

    const rawState   = row["State"] || row["state"] || row["Status"] || "DRAFT";
    const startedAt  = row["StartedAt (ISO)"] || row["StartIso"] || row["startIso"] || null;
    const endsAt     = row["EndsAt (ISO)"]   || row["EndIso"]   || row["endIso"]   || null;

    const durationSec = Number(row["DurationSec"] ?? row["durationSec"] ?? row["Duration (sec)"]);
    const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : undefined;

    const penaltyPerMin = Number(row["PenaltyPerMin"] || row["penaltyPerMin"] || 0) || 0;

    const state = normState(rawState);

    let remainingMs;
    if (state === "running" && endsAt) {
      const diff = new Date(endsAt).getTime() - Date.now();
      remainingMs = Math.max(0, diff);
    } else if (state === "paused") {
      const remainingSecFromSheet = Number(row["RemainingSec"] ?? row["remainingSec"]);
      if (Number.isFinite(remainingSecFromSheet) && remainingSecFromSheet >= 0) {
        remainingMs = Math.floor(remainingSecFromSheet * 1000);
      }
    } else if (state === "notstarted" && duration) {
      remainingMs = duration * 1000;
    } else {
      remainingMs = 0;
    }

    const payload = {
      eventId,
      state,
      running:   state === "running",
      paused:    state === "paused",
      ended:     state === "ended",
      published: state === "published",

      durationSec: duration,
      remainingMs: Number.isFinite(remainingMs) ? remainingMs : undefined,
      remainingSec: Number.isFinite(remainingMs) ? Math.floor(remainingMs / 1000) : undefined,

      startedAt: startedAt || null,
      startIso:  startedAt || null,
      endsAt:    endsAt || null,
      endIso:    endsAt || null,

      penaltyPerMin
    };

    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    return ok(payload);
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
