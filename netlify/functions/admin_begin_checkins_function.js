const { ok, bad, corsHeaders, getDoc, CURRENT_EVENT,
        requireAdmin, getCompetitionMap, setCompetitionValue } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  try {
    requireAdmin(event);
    const doc = await getDoc();

    const { map, sheet } = await getCompetitionMap(doc, CURRENT_EVENT);
    const state = map.state || 'PENDING';
    if (state === 'PUBLISHED') return ok({ success:true, state });
    if (state === 'CHECKIN') return ok({ success:true, state }); // idempotent
    // Allow switching from OPEN to CHECKIN
    await setCompetitionValue(sheet, CURRENT_EVENT, 'state', 'CHECKIN');
    return ok({ success:true, state:'CHECKIN' });
  } catch (e) {
    const code = e.statusCode || 500;
    return bad(code, 'Admin begin check-ins error', { error: e.message });
  }
};
