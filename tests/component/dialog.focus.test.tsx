// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useState, type ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dialog, { DialogActions } from "@/app/_components/Dialog";

/**
 * A page with something behind the dialog, a control that opens it, and — when `inner` is given — a
 * second dialog the first can open over itself (as a band's lineup opens a booking, feature 087).
 */
function Page({
  body,
  actions,
  inner,
}: {
  body: ReactNode;
  actions?: ReactNode;
  inner?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);
  return (
    <>
      <button type="button">Behind</button>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Dialog heading="Booking — Ann Fiddle" onClose={() => setOpen(false)} actions={actions}>
          {body}
          {inner && (
            <button type="button" onClick={() => setInnerOpen(true)}>
              Open inner
            </button>
          )}
          {innerOpen && (
            <Dialog heading="Inner" onClose={() => setInnerOpen(false)}>
              {inner}
            </Dialog>
          )}
        </Dialog>
      )}
    </>
  );
}

/** The focused element, narrowed for toContainElement (no cast). */
function active(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement ? el : null;
}

async function opened(props: Parameters<typeof Page>[0]) {
  const user = userEvent.setup();
  render(<Page {...props} />);
  await user.click(screen.getByRole("button", { name: "Open" }));
  return user;
}

const FIELDS = (
  <>
    <label>
      Fee <input name="fee" />
    </label>
    <label>
      Note <textarea name="note" />
    </label>
  </>
);

/** Feature 089 US2 (contracts/dialog.md): where focus goes, and where it may not. */
describe("Dialog — its name and its focus (089)", () => {
  it("is named by its heading, which it shows at the top (FR-008, R4)", async () => {
    await opened({ body: FIELDS });
    const dialog = screen.getByRole("dialog", { name: "Booking — Ann Fiddle" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Booking — Ann Fiddle",
    );
  });

  it("puts the cursor in its search box when it has one (D1)", async () => {
    await opened({
      body: (
        <>
          {FIELDS}
          <input type="search" aria-label="Find a performer" />
        </>
      ),
    });
    expect(screen.getByRole("searchbox", { name: "Find a performer" })).toHaveFocus();
  });

  it("otherwise puts it in its first field (D1)", async () => {
    await opened({ body: FIELDS });
    expect(screen.getByRole("textbox", { name: "Fee" })).toHaveFocus();
  });

  it("keeps Tab and Shift-Tab among its own controls, 30 presses each way (D2, SC-003)", async () => {
    const user = await opened({ body: FIELDS, actions: <button type="button">Save</button> });
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 30; i++) {
      await user.tab();
      expect(dialog).toContainElement(active());
    }
    for (let i = 0; i < 30; i++) {
      await user.tab({ shift: true });
      expect(dialog).toContainElement(active());
    }
  });

  it("wraps from its last control to its first, and back (D2)", async () => {
    const user = await opened({ body: FIELDS, actions: <button type="button">Save</button> });
    screen.getByRole("button", { name: "Save" }).focus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Fee" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
  });

  it("returns focus to the control that opened it (D9, FR-012)", async () => {
    const user = await opened({ body: FIELDS });
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("returns focus to the opener even when a field inside took focus on opening (D9)", async () => {
    const user = await opened({
      body: (
        <label>
          Paid by <input name="paid" autoFocus />
        </label>
      ),
    });
    expect(screen.getByRole("textbox", { name: "Paid by" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("gives a dialog opened over it the focus, then takes it back (D10, FR-013)", async () => {
    const user = await opened({
      body: FIELDS,
      inner: (
        <label>
          Amount <input name="amount" />
        </label>
      ),
    });
    await user.click(screen.getByRole("button", { name: "Open inner" }));
    const inner = screen.getByRole("dialog", { name: "Inner" });
    expect(within(inner).getByRole("textbox", { name: "Amount" })).toHaveFocus();

    for (let i = 0; i < 10; i++) {
      await user.tab();
      expect(inner).toContainElement(active());
    }

    await user.click(within(inner).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Inner" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open inner" })).toHaveFocus();
  });
});

describe("Dialog — its action bar (089)", () => {
  it("holds Close first, then the dialog's own actions in order (A4, FR-014)", async () => {
    await opened({
      body: FIELDS,
      actions: (
        <>
          <button type="button">Archive</button>
          <button type="button">Save</button>
        </>
      ),
    });
    const bar = within(screen.getByRole("dialog")).getByRole("group", { name: "Actions" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Close", "Archive", "Save"]);
  });

  it("puts a body component's <DialogActions> in the bar, after the owner's (FR-014)", async () => {
    await opened({
      actions: <button type="button">Archive</button>,
      body: (
        <>
          {FIELDS}
          <DialogActions>
            <button type="button">Save</button>
          </DialogActions>
        </>
      ),
    });
    const dialog = screen.getByRole("dialog");
    const bar = within(dialog).getByRole("group", { name: "Actions" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Close", "Archive", "Save"]);
  });

  it("renders <DialogActions> in place outside a dialog", () => {
    render(
      <DialogActions>
        <button type="button">Save</button>
      </DialogActions>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("holds Close alone when the dialog has no actions of its own (FR-019)", async () => {
    await opened({ body: <p>Read only</p> });
    const bar = within(screen.getByRole("dialog")).getByRole("group", { name: "Actions" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Close"]);
  });
});
