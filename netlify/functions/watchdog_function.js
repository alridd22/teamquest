const { ok, bad, corsHeaders, getDoc, getOrCreateSheet } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  try {
    const doc = await getDoc();
    await getOrCreateSheet(doc, 'teams', ['Team Code','Team Name','PIN','State','Device','LastSeen','Event Id']);
    await getOrCreateSheet(doc, 'team_states', ['Team Code','Activity','State','LockedAt','Nonce','LastResponse','Event Id']);
    await getOrCreateSheet(doc, 'submissions', ['Timestamp','Team Code','Activity','Nonce','Payload','AI Status','AI Attempts','AI Score','Final Score','Idempotency','Event Id']);
    await getOrCreateSheet(doc, 'competition', ['Event Id','Key','Value']);
    await getOrCreateSheet(doc, 'checkins', ['Team Code','CheckedInAt','Status','Penalty','Event Id']);
    return ok({ success:true, message:'Sheets checked/created' });
  } catch (e) {
    return bad(500, 'Watchdog error', { error:e.message });
  }
};
