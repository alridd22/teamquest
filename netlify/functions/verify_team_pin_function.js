const { ok, bad, corsHeaders, getDoc, getOrCreateSheet, signToken, CURRENT_EVENT, nowIso } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS')
    return { statusCode: 200, headers: corsHeaders, body: '' };

  try {
    const { teamCode, pin } = JSON.parse(event.body || '{}');
    if (!teamCode || !pin) return bad(400, 'teamCode and pin required');

    const doc = await getDoc();
    const teams = await getOrCreateSheet(doc, 'teams',
      ['Team Code','Team Name','PIN','State','Device','LastSeen','Event Id']);

    const rows = await teams.getRows();
    const row = rows.find(r =>
      (r.get('Team Code')||'').toUpperCase() === String(teamCode).toUpperCase()
      && (((r.get('Event Id')||'') === CURRENT_EVENT) || ((r.get('Event Id')||'')==='' && CURRENT_EVENT==='default'))
    );
    if (!row) return bad(401, 'Unknown team for this event');
    if ((row.get('PIN')||'').trim() !== String(pin).trim()) return bad(401, 'Invalid PIN');

    if (!row.get('State')) row.set('State','READY');
    row.set('LastSeen', nowIso());
    row.set('Event Id', row.get('Event Id') || CURRENT_EVENT);
    await row.save();

    const token = signToken({ team: row.get('Team Code'), event: CURRENT_EVENT });
    return ok({ success:true, token, teamCode: row.get('Team Code'), state: row.get('State')||'READY', event: CURRENT_EVENT });
  } catch (e) {
    return bad(500, 'Auth error', { error:e.message });
  }
};
