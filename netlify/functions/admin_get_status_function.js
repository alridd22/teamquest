const { ok, bad, corsHeaders, getDoc, getOrCreateSheet, CURRENT_EVENT,
        requireAdmin, getCompetitionMap } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  try {
    requireAdmin(event);
    const doc = await getDoc();

    // Competition kv
    const { map, sheet: compSheet } = await getCompetitionMap(doc, CURRENT_EVENT);
    const state = map.state || 'PENDING';
    const start_at = map.start_at || '';
    const publish_at = map.publish_at || '';
    const gallery_unlocked = map.gallery_unlocked === 'true';

    // Teams registration check
    const teams = await getOrCreateSheet(doc, 'teams', ['Team Code','Team Name','PIN','State','Device','LastSeen','Event Id']);
    const rows = await teams.getRows();
    const mine = rows.filter(r => String(r.get('Event Id')) === String(CURRENT_EVENT));
    const totalTeams = mine.length;
    const unregistered = mine.filter(r => !(r.get('Team Name') && r.get('PIN')));
    const registeredCount = totalTeams - unregistered.length;

    // Check-ins
    const checkins = await getOrCreateSheet(doc, 'checkins', ['Team Code','CheckedInAt','Status','Penalty','Event Id']);
    const crows = await checkins.getRows();
    const myCheckins = crows.filter(r => String(r.get('Event Id')) === String(CURRENT_EVENT));
    const checkedInTeams = new Set(myCheckins.map(r => r.get('Team Code')));

    return ok({
      success:true,
      event: CURRENT_EVENT,
      state,
      start_at,
      publish_at,
      gallery_unlocked,
      totals: { totalTeams, registeredCount, uncheckedCount: totalTeams - checkedInTeams.size },
      unregisteredTeams: unregistered.map(r => r.get('Team Code'))
    });
  } catch (e) {
    const code = e.statusCode || 500;
    return bad(code, 'Admin status error', { error: e.message });
  }
};
