const { ok, bad, corsHeaders, getDoc, getOrCreateSheet, CURRENT_EVENT,
        requireAdmin, nowIso, getCompetitionMap } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  try {
    requireAdmin(event);
    const { teamCode, status, penalty } = JSON.parse(event.body || '{}');
    if (!teamCode) return bad(400, 'teamCode required');
    const legitStatus = (status || 'ON_TIME').toUpperCase(); // ON_TIME | LATE | ABSENT
    const pen = Number(penalty || 0);

    const doc = await getDoc();
    const { map } = await getCompetitionMap(doc, CURRENT_EVENT);
    if (!['CHECKIN','PUBLISHED'].includes(map.state || '')) {
      // You can allow check-ins during OPEN if desired; keeping strict:
      return bad(400, 'Check-ins are not active (state must be CHECKIN or PUBLISHED)');
    }

    const checkins = await getOrCreateSheet(doc, 'checkins', ['Team Code','CheckedInAt','Status','Penalty','Event Id']);
    const rows = await checkins.getRows();
    let row = rows.find(r => r.get('Team Code') === teamCode && String(r.get('Event Id')) === String(CURRENT_EVENT));
    if (!row) {
      await checkins.addRow({
        'Team Code': teamCode,
        'CheckedInAt': nowIso(),
        'Status': legitStatus,
        'Penalty': String(pen),
        'Event Id': CURRENT_EVENT
      });
    } else {
      row.set('CheckedInAt', row.get('CheckedInAt') || nowIso()); // keep first check-in time
      row.set('Status', legitStatus);
      row.set('Penalty', String(pen));
      await row.save();
    }
    return ok({ success:true, teamCode, status: legitStatus, penalty: pen });
  } catch (e) {
    const code = e.statusCode || 500;
    return bad(code, 'Admin check-in error', { error: e.message });
  }
};
