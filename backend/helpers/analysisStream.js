const TERMINAL_STATUSES = new Set(['done', 'error', 'failed', 'completed', 'canceled']);

function isTerminalStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return Boolean(normalized) && TERMINAL_STATUSES.has(normalized);
}

function buildCursor(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }

  const last = events[events.length - 1];
  if (!last) return null;
  return `${last.created_at || ''}:${last.id || ''}`;
}

function didRunChange(previous, current) {
  if (!previous && !current) return false;
  if (!previous || !current) return true;

  return (
    previous.status !== current.status
    || previous.updated_at !== current.updated_at
    || previous.completed_at !== current.completed_at
    || previous.result_text !== current.result_text
    || previous.error !== current.error
  );
}

function getNewEvents(previousEvents, nextEvents) {
  const seenIds = new Set((previousEvents || []).map((event) => event.id));
  return (nextEvents || []).filter((event) => !seenIds.has(event.id));
}

function shouldStartStreamTimers({ snapshotSent, closed, writableEnded }) {
  return Boolean(snapshotSent) && !closed && !writableEnded;
}

module.exports = {
  TERMINAL_STATUSES,
  isTerminalStatus,
  buildCursor,
  didRunChange,
  getNewEvents,
  shouldStartStreamTimers,
};
