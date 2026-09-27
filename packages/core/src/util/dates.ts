/** UTC date helpers. All day keys are YYYY-MM-DD in UTC so output is deterministic. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DAY_MS = 86_400_000;

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateKey(key: string): Date {
  return new Date(`${key.slice(0, 10)}T00:00:00Z`);
}

export function addDays(key: string, days: number): string {
  return dateKey(new Date(parseDateKey(key).getTime() + days * DAY_MS));
}

export function weekday(key: string): number {
  return parseDateKey(key).getUTCDay();
}

export function shortMonth(key: string): string {
  const m = Number(key.split("-")[1]);
  return MONTHS[m - 1] ?? "?";
}

/** "Jul 5, 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  if (iso.length === 7) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Jul 5" */
export function formatDayMonth(key: string): string {
  const d = parseDateKey(key);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Parse RFC 822 (RSS) and ISO 8601 (Atom) dates. */
export function parseLooseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Last `months` month keys ending at `now`, oldest first. */
export function lastMonths(now: Date, months: number): string[] {
  const out: string[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(y, m - k, 1));
    out.push(dateKey(d).slice(0, 7));
  }
  return out;
}
