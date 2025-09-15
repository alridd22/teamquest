// /netlify/functions/get_leaderboard.js
const { google } = require('googleapis');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success:false, message:m }) });

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || '';

function parseServiceAccount() {
  // Accept JSON (raw or b64) …
  const rawJson =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (rawJson) {
    const text = rawJson.trim().startsWith('{') ? rawJson : Buffer.from(rawJson, 'base64').toString('utf8');
    return JSON.parse(text);
  }
  // …or email + key (raw or b64)
  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GCP_CLIENT_EMAIL || '';
  let key =
    process.env.GOOGLE_PRIVATE_KEY_B64
      ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, 'base64').toString('utf8')
      : (process.env.GOOGLE_PRIVATE_KEY || '');
  if (key) key = key.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing service account credentials.');
  return { type:'service_account', client_email: email, private_key: key, token_uri:'https://oauth2.googleapis.com/token' };
}

async function sheetsClient(){
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');
  const sa = parseServiceAccount();
  const jwt = new google.auth.JWT(sa.client_email, undefined, sa.private_key, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  await jwt.authorize();
  return google.sheets({ version:'v4', auth: jwt });
}

function toNum(v){ const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : 0; }
function normCode(v){ return String(v || '').trim().toUpperCase(); }
function headerIndex(row){ return Object.fromEntries((row||[]).map((h,i)=>[h, i])); }

async function readRange(sheets, sheetName){
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
    const rows = r.data.values || [];
    const headers = rows[0] || [];
    const pos = headerIndex(headers);
    return { rows, headers, pos };
  } catch (e) {
    // Missing sheet -> return empty
    return { rows: [], headers: [], pos: {} };
  }
}

function findSheetName(allTitles, wanted){
  const low = wanted.toLowerCase();
  return allTitles.find(t => String(t).toLowerCase() === low) || wanted;
}

async function listSheetTitles(sheets){
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (meta.data.sheets || []).map(s => s.properties.title);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers: CORS, body:'' };
    if (!['GET','POST'].includes(event.httpMethod)) return bad(405, 'Use GET');

    const qs = event.queryStringParameters || {};
    const body = event.httpMethod === 'POST' && event.body ? JSON.parse(event.body) : {};
    const eventId = (qs.eventId || qs.event || body.eventId || '').toString().trim();

    const sheets = await sheetsClient();
    const titles = await listSheetTitles(sheets);

    // Sheet names (case-insensitive; fallbacks)
    const eventsSheetName = findSheetName(titles, 'events');
    const teamsSheetName  = findSheetName(titles, 'teams');
    const scoresSheetName = findSheetName(titles, 'Scores'); // your tab is "Scores"

    // ----- Load event row -----
    const { rows: eRows, headers: eHdrs, pos: ePos } = await readRange(sheets, eventsSheetName);
    if (eRows.length < 2) return ok({ success:true, rows:[], lastUpdated:new Date().toISOString() });

    let evRow = null;
    if (eventId) {
      const colEventId = ePos['Event Id'];
      evRow = eRows.find((r, i) => i>0 && String(r[colEventId]||'').trim() === eventId) || null;
    } else {
      // No eventId passed: take the last (most recently updated) row
      evRow = eRows[eRows.length - 1];
    }
    if (!evRow) return bad(404, 'Event not found');

    const ev = Object.fromEntries(eHdrs.map((h,i)=>[h, evRow[i] ?? '']));
    const evId  = String(ev['Event Id'] || eventId || '').trim();
    const endsAtIso = ev['EndsAt (ISO)'] || '';
    const penaltyPerMin = toNum(ev['PenaltyPerMin'] || ev['Penalty Per Min'] || ev['Penalty'] || 0);
    const state = String(ev['State'] || '').toUpperCase();

    // ----- Load teams -----
    const { rows:tRows, headers:tHdrs, pos:tPos } = await readRange(sheets, teamsSheetName);
    const colEvent = tPos['Event Id'] ?? tPos['EventID'] ?? tPos['eventId'];
    const colCode  = tPos['Team Code'] ?? tPos['teamCode'] ?? tPos['Code'] ?? tPos['TEAM CODE'];
    const colName  = tPos['Name'] ?? tPos['Team Name'] ?? tPos['Team'] ?? tPos['team'];
    const colRet   = tPos['ReturnedAt (ISO)'] ?? tPos['Returned At (ISO)'] ?? tPos['ReturnedAt'] ?? tPos['Returned'];

    const teams = [];
    for (let i=1;i<tRows.length;i++){
      const r = tRows[i];
      if (colEvent != null && String(r[colEvent]||'').trim() !== evId) continue;
      const code = normCode(r[colCode]);
      if (!code) continue;
      teams.push({
        teamCode: code,
        teamName: r[colName] || code,
        returnedAt: r[colRet] || '',
      });
    }

    // ----- Load Scores and sum per team -----
    const { rows:sRows, headers:sHdrs, pos:sPos } = await readRange(sheets, scoresSheetName);
    const sEvent = sPos['Event Id'] ?? sPos['eventId'] ?? null; // optional
    const sCode  = sPos['Team Code'] ?? sPos['teamCode'] ?? sPos['Code'] ?? sPos['TEAM CODE'];
    const sScore = sPos['Score'] ?? sPos['Points'] ?? sPos['score'];
    const sStatus= sPos['Status'] ?? sPos['status'];

    const totals = new Map(); // code -> base score
    for (let i=1;i<sRows.length;i++){
      const r = sRows[i];
      if (sEvent != null && evId && String(r[sEvent]||'').trim() !== evId) continue; // if sheet has Event Id, filter to event
      const code = normCode(r[sCode]);
      if (!code) continue;
      // if Status column exists, only count rows with "final" (or blank if you prefer)
      const status = (r[sStatus] || '').toString().trim().toLowerCase();
      if (sStatus != null && status && status !== 'final' && status !== 'approved') continue;

      const points = toNum(r[sScore]);
      totals.set(code, (totals.get(code) || 0) + points);
    }

    // ----- Compute penalties per team (based on teams returnedAt & event endsAt) -----
    const endsAt = endsAtIso ? new Date(endsAtIso).getTime() : null;

    const rows = teams.map(t => {
      const base = totals.get(t.teamCode) || 0;

      let minutesLate = 0;
      if (endsAt && t.returnedAt) {
        const ret = new Date(t.returnedAt).getTime();
        if (Number.isFinite(ret)) {
          minutesLate = Math.max(0, Math.ceil((ret - endsAt)/60000));
        }
      } else if (endsAt && (state === 'ENDED' || state === 'PUBLISHED')) {
        // If event is finished and team never returned, treat as late until end time;
        // keep penalty at 0 here (policy choice). Change if you want to penalize non-returns.
        minutesLate = 0;
      }

      const penalty = Math.max(0, minutesLate * penaltyPerMin);
      const adjusted = Math.max(0, base - penalty);

      return {
        teamCode: t.teamCode,
        teamName: t.teamName,
        baseScore: base,
        totalScore: base,               // alias for older UIs
        penaltyApplied: penalty,
        penaltyPerMin,
        returnedAt: t.returnedAt || '',
        lateMins: minutesLate,
        score: adjusted,                // adjusted score (back-compat)
        adjustedScore: adjusted,
      };
    });

    // Sort by adjusted descending, then name
    rows.sort((a,b)=> (b.adjustedScore - a.adjustedScore) || a.teamName.localeCompare(b.teamName));

    return ok({
      success: true,
      eventId: evId,
      state,
      endsAt: endsAtIso || null,
      penaltyPerMin,
      rows,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error('get_leaderboard error:', err);
    return bad(500, err.message || 'Server error');
  }
};
