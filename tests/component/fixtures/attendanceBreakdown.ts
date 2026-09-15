import type { AttendanceBreakdown } from "@/server/domain/attendance/breakdownService";

/** Feature 079: an attendance breakdown for component tests, overridable per case. */
export const BREAKDOWN = (over: Partial<AttendanceBreakdown> = {}): AttendanceBreakdown => ({
  attendance: 42,
  paying: 33,
  children: 4,
  performers: { caller: 1, band: 3, soundTech: 0, instructor: 0 },
  doorAttendant: 1,
  comps: 4,
  giftCards: 2,
  doubleBookings: [],
  ...over,
});
