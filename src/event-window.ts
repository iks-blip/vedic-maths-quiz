const IST_OFFSET_MINUTES = 5 * 60 + 30;

function parseIsoWithOffsetToEpochMs(isoWithOffset: string): number {
  const value = Date.parse(isoWithOffset);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid event timestamp: ${isoWithOffset}`);
  }
  return value;
}

function formatIst(epochMs: number): string {
  const shifted = new Date(epochMs + IST_OFFSET_MINUTES * 60_000);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const min = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} IST`;
}

export function getEventWindowMs(): { startAtMs: number; endAtMs: number } {
  const startIso = process.env.EVENT_START_AT_IST ?? "2026-03-14T00:00:00+05:30";
  const endIso = process.env.EVENT_END_AT_IST ?? "2026-03-14T12:00:00+05:30";

  const startAtMs = parseIsoWithOffsetToEpochMs(startIso);
  const endAtMs = parseIsoWithOffsetToEpochMs(endIso);

  if (endAtMs <= startAtMs) {
    throw new Error("Event end must be after event start");
  }

  return { startAtMs, endAtMs };
}

export function eventWindowMessage(startAtMs: number, endAtMs: number): string {
  return `Event window is ${formatIst(startAtMs)} to ${formatIst(endAtMs)}.`;
}
