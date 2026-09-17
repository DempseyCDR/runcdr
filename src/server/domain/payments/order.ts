/**
 * Feature 081: the order performers and checks are listed in. Pure — no database imports — so the payments
 * page and the treasurer report share it.
 */

/** FR-003: the order Mary pays in — the caller first, then the band, the sound tech, then everyone else. */
const ROLE_ORDER = [
  "caller",
  "lead_musician",
  "musician",
  "sound_tech",
  "instructor",
  "open_band_musician",
];

const roleRank = (type: string) => {
  const i = ROLE_ORDER.indexOf(type);
  return i === -1 ? ROLE_ORDER.length : i;
};

/** A copy of `rows` in paying order: by role, then by performer name within a role. */
export function orderBookings<T extends { performerType: string; performerName: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      roleRank(a.performerType) - roleRank(b.performerType) ||
      a.performerName.localeCompare(b.performerName, undefined, { sensitivity: "base" }),
  );
}

/**
 * FR-039 (research R3a): check numbers in order — by their digits as a number, then by the letter a duplicate
 * check book adds, so 1500 < 1500A < 1500B < 1501.
 */
export function compareCheckNumbers(a: string, b: string): number {
  const split = (n: string) => {
    const m = /^(\d+)([A-Z]?)$/.exec(n);
    return m ? { digits: Number(m[1]), letter: m[2] ?? "" } : { digits: Infinity, letter: n };
  };
  const x = split(a);
  const y = split(b);
  return x.digits - y.digits || x.letter.localeCompare(y.letter);
}
