// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import TreasurerReportPage from "@/app/(admin)/treasurer/page";
import GatePage from "@/app/(door)/gate/page";
import PaymentsPage from "@/app/(admin)/payments/page";
import CheckinPage from "@/app/(door)/checkin/page";
import { REPORT } from "./fixtures/treasurerReport";
import { DOOR_RECORD } from "./fixtures/gatePage";

/**
 * Feature 086 US3 (FR-010, FR-013, analysis C1): the three pages that opt in, and the one that does not.
 *
 * `eventSelector.test.tsx` proves the component narrows when told to. THIS file proves each page tells
 * it to — without which the default could ship switched on for no page at all and every other test in
 * the feature would still pass. The check-in case is the same assertion inverted, and is the easiest
 * thing to break by accident, because all four surfaces share one selector.
 */
const EVENTS = [
  { id: "tnc1", eventDate: "2020-06-15", seriesId: "s1", startTime: "19:30:00", label: "Contra" },
  { id: "ecd1", eventDate: "2020-06-10", seriesId: "s2", startTime: "13:00:00", label: "English" },
];
const SERIES = [
  { id: "s1", key: "tnc", name: "TNC" },
  { id: "s2", key: "ecd", name: "ECD" },
];

/** A viewer whose roles name ECD alone — so a page that opted in must start on s2. */
function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      const u = String(url);
      const json = async (): Promise<unknown> => {
        const report = /\/events\/([^/]+)\/treasurer-report/.exec(u);
        if (report) return REPORT(report[1]!);
        if (u.includes("/api/me/capabilities")) {
          return {
            mySeriesIds: ["s2"],
            gateWrite: true,
            attendanceWrite: true,
            performerPaymentWrite: true,
            bookingWrite: true,
            eventWrite: true,
            contactWrite: true,
            membershipWrite: true,
          };
        }
        // The gate and payments pages load an evening's own records once one is chosen. They are not
        // what this file is about — it asserts only where the selector STARTS — but leaving them
        // unanswered produces unhandled rejections that would mask a real failure later.
        if (u.includes("/door-record")) return { doorRecord: DOOR_RECORD(), checks: [], sales: [] };
        if (u.includes("/payment-summary")) return { bookings: [], payments: [], totals: {} };
        if (u.includes("/attendance-breakdown")) {
          return {
            attendance: 0,
            paying: 0,
            children: 0,
            performers: {},
            doorAttendant: 0,
            comps: 0,
            giftCards: 0,
            doubleBookings: [],
          };
        }
        if (u.includes("/api/series")) return { items: SERIES };
        if (u.includes("/api/events")) return { items: EVENTS };
        return { items: [] };
      };
      return { ok: true, status: init?.method === "POST" ? 201 : 200, json };
    }),
  );
}

const seriesFilter = () => screen.getByLabelText("Filter series") as HTMLSelectElement;

describe("the series default, page by page (086)", () => {
  // Unmount BEFORE the stub goes: a page left mounted keeps fetching, hits the real `fetch`, and
  // rejects on a relative URL — noise that would mask a genuine failure later.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("the gate report starts on the viewer's series", async () => {
    stub();
    render(<TreasurerReportPage />);
    await waitFor(() => expect(seriesFilter().value).toBe("s2"));
  });

  it("gate money starts on the viewer's series", async () => {
    stub();
    render(<GatePage />);
    await waitFor(() => expect(seriesFilter().value).toBe("s2"));
  });

  it("payments starts on the viewer's series", async () => {
    stub();
    render(<PaymentsPage />);
    await waitFor(() => expect(seriesFilter().value).toBe("s2"));
  });

  it("check-in does NOT — it is deliberately left alone (FR-013)", async () => {
    stub();
    render(<CheckinPage />);
    // Give the same chance to narrow that the others took, then confirm it did not.
    await waitFor(() => expect(seriesFilter()).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(seriesFilter().value).toBe("");
  });
});
