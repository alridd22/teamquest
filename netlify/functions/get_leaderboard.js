// /netlify/functions/get_leaderboard.js
const { ok, bad } = require("./_lib/http");
const { google } = require("googleapis");

/* ---------- config ---------- */
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || "";
const SUBMISSIONS_SHEET = process.env.SUBMISSIONS_SHEET_NAME || "submissions";
const TEAMS_SHEET = process.env.TEAMS_SHEET_NAME || "teams";

/* ---------- auth / sheets helpers ---------- */
function parseServiceAccount() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT || "";
  if (raw) {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(text);
  }
  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GCP_CLIENT_EMAIL || "";
  let key =
    process.env.GOOGLE_PRIVATE_KEY_B64
      ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf8")
      : (process.env.GOOGLE_PRIVATE_KEY || "");
  if (key) key = key.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing service account creds (JSON or EMAIL + PRIVATE_KEY(_B64)).");
  return { type: "service_account", client_email: email, private_key: key, token_uri: "https://oauth2.googleapis.com/token" };
}

async function sheetsClient() {
  if (!SPREADSHEET_ID) throw new Error("Missing GOOGLE_SHEET_ID / SPREADSHEET_ID");
  const sa = parseServiceAccount();
  const jwt = new google.auth.JWT(sa.client_email, undefined, sa.private_key, ["https://www.googleapis.com/auth/spreadsheets"]);
  await jwt.authorize();
  return google.sheets({ version: "v4", auth: jwt });
}

async function readSheet(sheets, sheetName) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
  const rows = r.data.values || [];
  const headers = rows[0] || [];
  const pos = Object.fromEntries(headers.map((h, i) => [h, i]));
  return { rows, headers, pos };
}

const num = (v) => (Number.isFinite(+v) ? +v : 0);

/* ---------- returned / penalty from teams ---------- */
function returnedFrom(row) {
  const returnedAt = (row["ReturnedAt (ISO)"] || row["returnedAt"] || "").toString().trim();
  const returned = !!returnedAt || String(row["Returned"] || "").toUpperCase().trim() === "TRUE";
  return { returned, returnedAt };
}
function penaltyFrom(row) {
  const p = row["LatePenalty"] ?? row["Penalty"] ?? row["latePenalty"] ?? row["late_penalty"];
  return num(p);
}

/* ---------- main handler ---------- */
exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const eventId = url.searchParams.get("eventId") || url.searchParams.get("event") || "";
    if (!eventId) return bad(400, "Missing eventId");

    const sheets = await sheetsClient();

    // 1) TEAMS: roster, returned flags, penalties
    const { rows: tRows, headers: tHdrs, pos: tPos } = await readSheet(sheets, TEAMS_SHEET);
    const tColEvent = tPos["Event Id"] ?? tPos["EventID"] ?? tPos["eventId"];
    const tColCode  = tPos["Team Code"] ?? tPos["teamCode"] ?? tPos["Code"];
    const tColName  = tPos["Team Name"] ?? tPos["teamName"] ?? tPos["Name"];
    const teamIndex = new Map(); // CODE -> meta
    if (tRows.length > 1 && tColEvent != null) {
      for (let i = 1; i < tRows.length; i++) {
        const r = tRows[i];
        if ((r[tColEvent] || "").toString().trim() !== eventId) continue;
        const obj = Object.fromEntries(tHdrs.map((h, c) => [h, r[c] ?? ""]));
        const code = String(obj[tHdrs[tColCode]] || obj["Team Code"] || "").trim().toUpperCase();
        const name = String(obj[tHdrs[tColName]] || obj["Team Name"] || code || "—").trim();
        const flags = returnedFrom(obj);
        const pen = penaltyFrom(obj);
        if (code) teamIndex.set(code, { teamCode: code, teamName: name, ...flags, penalty: pen });
      }
    }

    // 2) SUBMISSIONS: aggregate SUM per activity per team
    const { rows: sRows, headers: sHdrs, pos: sPos } = await readSheet(sheets, SUBMISSIONS_SHEET);
    const sColEvent = sPos["Event Id"] ?? sPos["EventID"] ?? sPos["eventId"];
    const sColCode  = sPos["Team Code"] ?? sPos["teamCode"] ?? sPos["Code"];
    const sColAct   = sPos["Activity"] ?? sPos["activity"] ?? null;
    // preferred score columns (first one found will be used)
    const scoreCols = ["Final Score", "FinalScore", "AI Score", "AIScore", "Score"];
    const sColScore = scoreCols.find(h => sPos[h] != null);

    const agg = new Map(); // CODE -> { cluehunt, quiz, scavenger, kindness, limerick }
    if (sRows.length > 1 && sColEvent != null && sColCode != null && sColAct != null && sColScore != null) {
      for (let i = 1; i < sRows.length; i++) {
        const r = sRows[i];
        if ((r[sColEvent] || "").toString().trim() !== eventId) continue;
        const code = String(r[sColCode] || "").trim().toUpperCase();
        if (!code) continue;

        const rawAct = String(r[sColAct] || "").trim().toLowerCase();
        const key =
          rawAct === "clue" ? "cluehunt" :
          rawAct === "quiz" ? "quiz" :
          rawAct === "scavenger" ? "scavenger" :
          rawAct === "kindness" ? "kindness" :
          rawAct === "limerick" ? "limerick" :
          null;
        if (!key) continue;

        const score = num(r[sColScore]);
        if (!agg.has(code)) agg.set(code, { cluehunt:0, quiz:0, scavenger:0, kindness:0, limerick:0 });
        // SUM scores (requested behaviour)
        agg.get(code)[key] += score;
      }
    }

    // 3) Build leaderboard: include any team with roster or submissions
    const allCodes = new Set([...agg.keys(), ...teamIndex.keys()]);
    const rows = [];
    for (const code of allCodes) {
      const scores = agg.get(code) || { cluehunt:0, quiz:0, scavenger:0, kindness:0, limerick:0 };
      const teamMeta = teamIndex.get(code) || { teamCode: code, teamName: code, returned:false, returnedAt:"", penalty:0 };
      const totalRaw = scores.cluehunt + scores.quiz + scores.scavenger + scores.kindness + scores.limerick;
      const total = Math.max(0, totalRaw - num(teamMeta.penalty));
      rows.push({
        teamCode: teamMeta.teamCode,
        teamName: teamMeta.teamName,
        cluehunt: scores.cluehunt,
        quiz: scores.quiz,
        scavenger: scores.scavenger,
        kindness: scores.kindness,
        limerick: scores.limerick,
        penalty: num(teamMeta.penalty),
        total,
        returned: !!teamMeta.returned,
        returnedAt: teamMeta.returnedAt || "",
      });
    }

    // sort: total desc, name asc
    rows.sort((a, b) => b.total - a.total || a.teamName.localeCompare(b.teamName));

    return ok({ eventId, leaderboard: rows });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
