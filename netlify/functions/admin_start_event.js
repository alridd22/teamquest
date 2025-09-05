// Normalize action and map synonyms
const actionIn = (body.action || 'start').toString().trim().toLowerCase();
const action = ({ stop: 'end' }[actionIn]) || actionIn;

const now = new Date();
const nowIso = now.toISOString();
const durationSec = Number(row.DurationSec || row['DurationSec'] || 0);

// Convenience helpers for time updates
const setRunning = async () => {
  const startedAtIso = nowIso;
  const endsAtIso = new Date(now.getTime() + durationSec * 1000).toISOString();
  await eventsSheet.updateRow(rowIndex, {
    'State': 'RUNNING',
    'StartedAt (ISO)': startedAtIso,
    'EndsAt (ISO)': endsAtIso,
    'UpdatedAt (ISO)': nowIso,
  });
  return { success: true, state: 'RUNNING', startedAt: startedAtIso, endsAt: endsAtIso, durationSec };
};

const setPaused = async () => {
  await eventsSheet.updateRow(rowIndex, {
    'State': 'PAUSED',
    // keep StartedAt/EndsAt as-is; UI freezes the countdown
    'UpdatedAt (ISO)': nowIso,
  });
  return { success: true, state: 'PAUSED' };
};

const setEnded = async () => {
  await eventsSheet.updateRow(rowIndex, {
    'State': 'ENDED',
    'UpdatedAt (ISO)': nowIso,
  });
  return { success: true, state: 'ENDED' };
};

const setReset = async () => {
  await eventsSheet.updateRow(rowIndex, {
    'State': 'NOT_STARTED',
    'StartedAt (ISO)': '',
    'EndsAt (ISO)': '',
    'UpdatedAt (ISO)': nowIso,
  });
  return { success: true, state: 'NOT_STARTED' };
};

// Execute
let result;
switch (action) {
  case 'start':  result = await setRunning(); break;
  case 'pause':  result = await setPaused();  break;
  case 'end':    result = await setEnded();   break;
  case 'reset':  result = await setReset();   break;
  default:
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, message: `Unknown action: ${actionIn}` })
    };
}

// Respond
return {
  statusCode: 200,
  body: JSON.stringify(result)
};
