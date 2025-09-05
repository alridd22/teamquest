// inside your handler, after you've validated admin auth and loaded the event row
// Assumes headers: Event Id | Name | State | DurationSec | PenaltyPerMin | StartedAt (ISO) | EndsAt (ISO) | ... | UpdatedAt (ISO)

switch ((body.action || 'start').toLowerCase()) {
  case 'start':
    // ... your existing start logic
    break;

  case 'pause':
    // ... your existing pause logic
    break;

  case 'end':
    // ... your existing end logic
    break;

  case 'reset': {
    const nowIso = new Date().toISOString();
    // Update the row for this eventId
    await eventsSheet.updateRow(rowIndex, {
      'State': 'NOT_STARTED',
      'StartedAt (ISO)': '',
      'EndsAt (ISO)': '',
      'UpdatedAt (ISO)': nowIso,
      // keep DurationSec + PenaltyPerMin as they are
    });

    return ok({
      success: true,
      eventId,
      state: 'NOT_STARTED',
      message: 'Event reset to not started.',
    });
  }

  default:
    return bad(400, `Unknown action: ${body.action}`);
}
