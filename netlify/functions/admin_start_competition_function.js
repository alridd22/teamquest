const { ok, bad, corsHeaders, getDoc, getOrCreateSheet, CURRENT_EVENT,
        requireAdmin, getCompetitionMap, setCompetitionValue, nowIso } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  try {
    requireAdmin(event);
    const doc = await getDoc();

    // Ensure all teams for event exist; optional strictness
    const teams = await getOrCreateSheet(doc, 'teams', ['Team Code','Team Name','PIN','State','Device','LastSeen','Event Id']);
    const rows = await teams.getRows();
    const mine = rows.filter(r => String(r.get('Event Id')) === String(CURRENT_EVENT));
    const unregistered = mine.filter(r => !(r.get('Team Name') && r.get('PIN')));
    if (unregistered.length > 0) {
      // If you prefer to allow force start: remove this block, or add query ?force=true
      const force = event.queryStringParameters?.force === 'true';
      if (!force) return bad(400, 'Some teams are not registered (name+PIN missing)', { unregistered: unregistered.map(r => r.get('Team Code')) });
    }

    const { map, sheet: compSheet } = await getCompetitionMap(doc, CURRENT_EVENT);
    const state = map.state || 'PENDING';
    if (state === 'OPEN' || state === 'CHECKIN' || state === 'PUBLISHED') {
      return ok({ success:true, state, start_at: map.start_at || '' }); // idempotent
    }
    // set once
    await setCompetitionValue(compSheet, CURRENT_EVENT, 'state', 'OPEN');
    const started = map.start_at || nowIso();
    await setCompetitionValue(compSheet, CURRENT_EVENT, 'start_at', started);

    return ok({ success:true, state:'OPEN', start_at: started });
  } catch (e) {
    const code = e.statusCode || 500;
    return bad(code, 'Admin start error', { error: e.message });
  }
};
