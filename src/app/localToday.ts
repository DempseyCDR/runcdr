/**
 * Feature 079 (research R9): today's date on this device, as `YYYY-MM-DD`.
 *
 * The door phone is at the venue, so its local date is the evening's date. `toISOString()` gives the UTC
 * date instead — which, after 8 pm on the East Coast, is already tomorrow.
 */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
