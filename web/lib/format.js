// Presentation helpers. Money arrives from the API as integer paisa and is only divided here, for display.

export function formatMoney(paisa) {
  const taka = paisa / 100;
  return `৳${Number.isInteger(taka) ? taka : taka.toFixed(2)}`;
}

export const ACTIVE_STATUSES = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

export const REQUEST_STATUS = {
  REQUESTED: { label: 'Waiting for a Tesla', tone: 'wait' },
  MATCHED: { label: 'Matched, Tesla is on the way', tone: 'go' },
  DRIVER_ARRIVED: { label: 'Tesla has arrived', tone: 'go' },
  STARTED: { label: 'Ride in progress', tone: 'go' },
  COMPLETED: { label: 'Completed', tone: 'done' },
  CANCELLED: { label: 'Cancelled', tone: 'off' },
};

export const POOL_STATUS = {
  ACCEPTED: { label: 'Waiting at pickup', tone: 'wait' },
  DRIVER_ARRIVED: { label: 'Arrived, ready to go', tone: 'go' },
  STARTED: { label: 'On the road', tone: 'go' },
  COMPLETED: { label: 'Completed', tone: 'done' },
  CANCELLED: { label: 'Cancelled', tone: 'off' },
};

// The passenger-facing happy path, in order (this IS a real sequence, so a stepper is appropriate).
export const PASSENGER_STEPS = [
  { key: 'REQUESTED', label: 'Requested' },
  { key: 'MATCHED', label: 'Matched' },
  { key: 'DRIVER_ARRIVED', label: 'Arrived' },
  { key: 'STARTED', label: 'On the way' },
  { key: 'COMPLETED', label: 'Done' },
];

export function zoneName(zones, id) {
  return zones.find((z) => z.id === id)?.name ?? id;
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function describeEvent(e) {
  if (e.metadata?.type === 'FARE_RECALCULATED') {
    return `Fare updated from ${formatMoney(e.metadata.fromPaisa)} to ${formatMoney(e.metadata.toPaisa)}`;
  }
  if (e.from === null) return 'Ride requested';
  if (e.to === 'MATCHED') return e.metadata?.source === 'AUTO_MATCH' ? 'Matched to a Tesla automatically' : 'A driver accepted your ride';
  if (e.to === 'REQUESTED') return 'Driver cancelled, back in the queue';
  return REQUEST_STATUS[e.to]?.label ?? e.to;
}
