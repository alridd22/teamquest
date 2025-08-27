const { ok, bad, corsHeaders, getDoc, CURRENT_EVENT,
        requireAdmin, getCompetitionMap, setCompetitionValue, nowIso } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  try {
    requireAdmin(event);
    const doc = await getDoc();

    const { map, sheet } = await getCompetitionMap(doc, CURRENT_EVENT);
    if ((map.state || '') === 'PUBLISHED') {
      return ok({ success:true, state:'PUBLISHED', publish_at: map.publish_at, gallery_unlocked: map.gallery_unlocked === 'true' });
    }

    // You can enforce that all teams checked in before publish — or allow publish anyway.
    await setCompetitionValue(sheet, CURRENT_EVENT, 'state', 'PUBLISHED');
    const when = map.publish_at || nowIso();
    await setCompetitionValue(sheet, CURRENT_EVENT, 'publish_at', when);
    await setCompetitionValue(sheet, CURRENT_EVENT, 'gallery_unlocked', 'true');

    return ok({ success:true, state:'PUBLISHED', publish_at: when, gallery_unlocked: true });
  } catch (e) {
    const code = e.statusCode || 500;
    return bad(code, 'Admin publish error', { error: e.message });
  }
};
