/**
 * Branch opening-hours evaluation (issue #36 closed-state overlay). The seed stores
 * hours as `{ open: "HH:MM", close: "HH:MM", days: number[] }` where `days` are
 * JS day-of-week numbers (0 = Sunday … 6 = Saturday).
 *
 * All comparisons are done in Pakistan Standard Time (UTC+5, no DST) so the result
 * is independent of the server's timezone. This is the single source of truth for
 * "is this branch open right now" — the client renders the label the server returns.
 */
export type BranchHours =
  { open?: string | null; close?: string | null; days?: number[] | null } | null | undefined;

const PKT_OFFSET_MINUTES = 5 * 60;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export type OpenState = { isOpen: boolean; opensAtLabel: string | null };

/**
 * @param hours branch `hoursJson`
 * @param nowMs current time in epoch ms (pass `Date.now()`)
 */
export function branchOpenState(hours: BranchHours, nowMs: number): OpenState {
  // No hours recorded → treat as always open (don't hide/dim on missing data).
  if (!hours || !hours.open || !hours.close) return { isOpen: true, opensAtLabel: null };
  const openM = toMinutes(hours.open);
  const closeM = toMinutes(hours.close);
  if (openM == null || closeM == null) return { isOpen: true, opensAtLabel: null };

  const days = hours.days && hours.days.length ? hours.days : ALL_DAYS;

  // Shift into PKT wall-clock, then read UTC getters so no local TZ leaks in.
  const pkt = new Date(nowMs + PKT_OFFSET_MINUTES * 60_000);
  const day = pkt.getUTCDay();
  const mins = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();

  const spansMidnight = closeM <= openM;
  let isOpen = false;
  if (days.includes(day)) {
    isOpen = spansMidnight ? mins >= openM || mins < closeM : mins >= openM && mins < closeM;
  }
  // Early-morning spill-over from the previous day's overnight window.
  if (!isOpen && spansMidnight && days.includes((day + 6) % 7) && mins < closeM) {
    isOpen = true;
  }

  return { isOpen, opensAtLabel: isOpen ? null : hours.open };
}
