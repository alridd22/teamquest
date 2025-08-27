const { ok, bad, corsHeaders, getDoc, CURRENT_EVENT,
        requireAdmin, getCompetitionMap, setCompetitionValue, nowIso } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  try {
    requireAdmin(event);
    const doc = await getDoc();

    const { sheet } = await getCompetitionMap(doc, CURRENT_EVENT);
    const nonce = String(Date.now());
    await setCompetitionValue(sheet, CURRENT_EVENT, 'cache_bust', nonce);
    await setCompetitionValue(sheet, CURRENT_EVENT, 'last_recalc_at', nowIso());

    return ok({ success:true, cache_bust: nonce });
  } catch (e) {
    const code = e.statusCode || 500;
    return bad(code, 'Admin recalc error', { error: e.message });
  }
};
