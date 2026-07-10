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
    // For an overnight window the current day owns ONLY the evening segment
    // (>= openM). The early-morning segment (< closeM) belongs to the PREVIOUS
    // day's window and is handled by the spill-over check below — otherwise a
    // window like {open:22:00, close:02:00, days:[Tue]} would wrongly report open
    // at 01:00 Tue, before Tuesday's 22:00 opening.
    isOpen = spansMidnight ? mins >= openM : mins >= openM && mins < closeM;
  }
  // Early-morning spill-over: the previous day's overnight window is still running.
  if (!isOpen && spansMidnight && days.includes((day + 6) % 7) && mins < closeM) {
    isOpen = true;
  }

  return { isOpen, opensAtLabel: isOpen ? null : hours.open };
}

/**
 * Structured opening-hours evaluation over the BranchHours model rows (#19). One row is
 * one open window: `{ dayOfWeek, openMinute, closeMinute }` where dayOfWeek is a JS weekday
 * (0 = Sunday … 6 = Saturday) and the minutes are since-midnight in PKT. A window with
 * closeMinute <= openMinute spans midnight (the tail spills into the next calendar day).
 *
 * Semantics match branchOpenState: PKT wall-clock, overnight spill-over from the previous
 * day, and no rows → always open. This is what Branch.isOpenNow / the placeOrder guard use
 * once a branch has structured hours; hoursJson remains the fallback for un-migrated branches.
 */
export type BranchHoursRow = { dayOfWeek: number; openMinute: number; closeMinute: number };

function minutesToLabel(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function branchHoursOpenState(rows: BranchHoursRow[], nowMs: number): OpenState {
  // No structured hours recorded → caller falls back (hoursJson, then always-open).
  if (!rows || rows.length === 0) return { isOpen: true, opensAtLabel: null };

  const pkt = new Date(nowMs + PKT_OFFSET_MINUTES * 60_000);
  const day = pkt.getUTCDay();
  const mins = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();

  for (const r of rows) {
    const spansMidnight = r.closeMinute <= r.openMinute;
    // Today's segment: full window when same-day, else just the evening (>= open) part.
    if (r.dayOfWeek === day) {
      if (spansMidnight ? mins >= r.openMinute : mins >= r.openMinute && mins < r.closeMinute) {
        return { isOpen: true, opensAtLabel: null };
      }
    }
    // Early-morning spill-over from the previous day's overnight window.
    if (spansMidnight && r.dayOfWeek === (day + 6) % 7 && mins < r.closeMinute) {
      return { isOpen: true, opensAtLabel: null };
    }
  }

  // Closed now → label the next opening time. Pick the window with the smallest
  // forward weekday distance from today, breaking ties by earliest openMinute. A
  // window later TODAY has distance 0; any window whose day is today but already
  // passed rolls a full week forward (distance 7), so a Saturday-night opening is
  // chosen over a Monday-morning one on Friday instead of sorting on openMinute alone.
  const forwardDistance = (r: BranchHoursRow): number => {
    if (r.dayOfWeek === day) return r.openMinute > mins ? 0 : 7;
    return (r.dayOfWeek - day + 7) % 7;
  };
  const next = [...rows].sort(
    (a, b) => forwardDistance(a) - forwardDistance(b) || a.openMinute - b.openMinute,
  )[0];
  return { isOpen: false, opensAtLabel: next ? minutesToLabel(next.openMinute) : null };
}
