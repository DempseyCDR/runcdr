// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentsPage from "@/app/(admin)/payments/page";
import { BOOKING, stubPayments, writesTo, type StubOpts } from "./fixtures/paymentsPage";

/**
 * Feature 087 US3 (FR-030a, FR-030b) — the performer editor, hosted on the payments page too.
 *
 * The performers page is gone. The Financial Secretary and the Treasurer edited performers there —
 * correcting a name before writing the check — and they must keep that without a performers page, so the
 * SAME form is offered from the payments page. Moving the editor between pages widens nothing: it is
 * offered only to a holder of `performer.write`, as it is on the hub, and the server refuses everyone else.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ZED = BOOKING({ id: "b-zed", performerName: "Zed Musician" });
const CAL = BOOKING({ id: "b-cal", performerName: "Cal Caller", performerType: "caller" });

async function open(opts: StubOpts = {}) {
  const calls = stubPayments({ bookings: [ZED, CAL], ...opts });
  render(<PaymentsPage />);
  await screen.findByRole("listitem", { name: "Zed Musician" });
  return calls;
}

describe("PaymentsPage — the performer editor (087 FR-030a)", () => {
  it("lets a Financial Secretary open a performer and correct the name (T051)", async () => {
    const calls = await open({ performerWrite: true });
    const zed = within(screen.getByRole("listitem", { name: "Zed Musician" }));
    await userEvent.click(zed.getByRole("button", { name: /edit zed musician/i }));

    const form = await screen.findByRole("dialog", { name: "Zed Musician" });
    const name = await within(form).findByLabelText("Display name");
    await userEvent.clear(name);
    await userEvent.type(name, "Zed Musicianer");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(writesTo(calls, "PATCH", "/api/performers/p-b-zed")).toHaveLength(1),
    );
    expect(writesTo(calls, "PATCH", "/api/performers/p-b-zed")[0]!.body).toEqual({
      displayName: "Zed Musicianer",
    });
  });

  it("offers no editor to a payer who may not edit performers (T050, FR-030b)", async () => {
    await open({ canWrite: true, performerWrite: false });
    expect(screen.queryByRole("button", { name: /edit zed musician/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /edit cal caller/i })).toBeNull();
  });
});
