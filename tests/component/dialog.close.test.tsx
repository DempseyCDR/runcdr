// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dialog, { DialogActions, useDialogSaved } from "@/app/_components/Dialog";

// Each test's dialogs are unmounted here and the history step they take back is let finish, so one
// test's `history.go(-n)` never lands in the next test.
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 20));
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/** A body with a field, a search box, and a Save that keeps the dialog open (a lineup's booking). */
function Body() {
  const saved = useDialogSaved();
  return (
    <>
      <label>
        Fee <input name="fee" />
      </label>
      <input type="search" aria-label="Find a performer" />
      <button type="button" onClick={saved}>
        Save and stay
      </button>
    </>
  );
}

function Page({
  actions,
  onClose,
  second,
}: {
  actions?: ReactNode;
  onClose?: () => void;
  second?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [both, setBoth] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {second && (
        <button type="button" onClick={() => setBoth(true)}>
          Open both
        </button>
      )}
      {open && (
        <Dialog
          heading="Outer"
          actions={actions}
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        >
          <Body />
          <button type="button" onClick={() => setBoth(true)}>
            Open inner
          </button>
          {both && (
            <Dialog heading="Inner" onClose={() => setBoth(false)}>
              <p>Inner body</p>
              <button type="button" onClick={() => setOpen(false)}>
                Close everything
              </button>
            </Dialog>
          )}
        </Dialog>
      )}
    </>
  );
}

async function opened(props: Parameters<typeof Page>[0] = {}) {
  const user = userEvent.setup();
  render(<Page {...props} />);
  await user.click(screen.getByRole("button", { name: "Open" }));
  return user;
}

const back = () => act(() => window.history.back());
const question = () => screen.queryByText("Discard your changes?");

/** The backdrop the dialog sits on — its parent element. */
function backdrop(): HTMLElement {
  const el = screen.getByRole("dialog").parentElement;
  if (!el) throw new Error("the dialog has no backdrop");
  return el;
}

/** Feature 089 US2 (contracts/dialog.md D3–D11): every way a dialog closes. */
describe("Dialog — closing it (089)", () => {
  it("closes on Close and on Escape when nothing has changed (D3, D6)", async () => {
    const onClose = vi.fn();
    const user = await opened({ onClose });
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pushes one history entry at the same address when it opens (R2)", async () => {
    const push = vi.spyOn(window.history, "pushState");
    await opened();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[0]).toMatchObject({ runcdrDialog: expect.any(Number) });
    expect(window.location.pathname).toBe("/");
  });

  it("closes on Back, and only the top dialog (D4, FR-008b)", async () => {
    const user = await opened();
    await user.click(screen.getByRole("button", { name: "Open inner" }));
    expect(screen.getByRole("dialog", { name: "Inner" })).toBeInTheDocument();

    await back();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Inner" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeInTheDocument();

    await back();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Outer" })).toBeNull());
  });

  it("ignores a tap outside when it has actions of its own (D5, FR-008a)", async () => {
    const user = await opened({ actions: <button type="button">Save</button> });
    await user.click(backdrop());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("counts a body's <DialogActions> as actions of its own (D5, FR-008a)", async () => {
    const user = userEvent.setup();
    render(
      <Dialog heading="Performer" onClose={() => {}}>
        <DialogActions>
          <button type="button">Save</button>
        </DialogActions>
      </Dialog>,
    );
    await user.click(backdrop());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on a tap outside when it has none (D5, FR-008a)", async () => {
    const user = await opened();
    await user.click(backdrop());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not close on a tap inside it (D5)", async () => {
    const user = await opened();
    await user.click(screen.getByRole("heading", { name: "Outer" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Dialog — unsaved changes (089, FR-012a)", () => {
  it("asks before Close discards what was typed; Keep editing keeps it (D6a, D7)", async () => {
    const onClose = vi.fn();
    const user = await opened({ onClose });
    await user.type(screen.getByRole("textbox", { name: "Fee" }), "20");
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(question()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(question()).toBeNull();
    expect(screen.getByRole("textbox", { name: "Fee" })).toHaveValue("20");
  });

  it("closes when the volunteer chooses Discard (D6a)", async () => {
    const onClose = vi.fn();
    const user = await opened({ onClose });
    await user.type(screen.getByRole("textbox", { name: "Fee" }), "20");
    await user.keyboard("{Escape}");
    expect(question()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks on Back too, and Keep editing puts its history entry back (D4, D6a)", async () => {
    const user = await opened();
    await user.type(screen.getByRole("textbox", { name: "Fee" }), "20");
    const depth = window.history.length;

    await back();
    await waitFor(() => expect(question()).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(window.history.state).toMatchObject({ runcdrDialog: expect.anything() });
    expect(window.history.length).toBe(depth);
  });

  it("asks on a tap outside a dialog with no actions of its own (D5, D6a)", async () => {
    const user = await opened();
    await user.type(screen.getByRole("textbox", { name: "Fee" }), "20");
    await user.click(backdrop());
    expect(question()).toBeInTheDocument();
  });

  it("does not count typing in a search box as a change (D7)", async () => {
    const onClose = vi.fn();
    const user = await opened({ onClose });
    await user.type(screen.getByRole("searchbox", { name: "Find a performer" }), "Ann");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(question()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not ask after a save that leaves it open (D8, useDialogSaved)", async () => {
    const onClose = vi.fn();
    const user = await opened({ onClose });
    await user.type(screen.getByRole("textbox", { name: "Fee" }), "20");
    await user.click(screen.getByRole("button", { name: "Save and stay" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(question()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Dialog — a settled dialog (089)", () => {
  it("closes without asking once its owner says its business is done", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog heading="Add contact" onClose={onClose} settled>
        <label>
          First name <input name="first" />
        </label>
      </Dialog>,
    );
    await user.type(screen.getByRole("textbox", { name: "First name" }), "Ann");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(question()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Dialog — the page behind it and its history (089)", () => {
  it("stops the page behind from scrolling while any dialog is open (D11, FR-009)", async () => {
    const user = await opened();
    expect(document.documentElement.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Open inner" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Inner" })).getByRole("button", {
        name: "Close",
      }),
    );
    expect(document.documentElement.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("goes back once when two dialogs close in one render (R2)", async () => {
    const user = await opened();
    await user.click(screen.getByRole("button", { name: "Open inner" }));
    const go = vi.spyOn(window.history, "go");
    await user.click(screen.getByRole("button", { name: "Close everything" }));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(go).toHaveBeenCalledWith(-2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves history alone when the address changed while it was open (R2)", async () => {
    const user = await opened();
    window.history.replaceState(null, "", "/elsewhere");
    const go = vi.spyOn(window.history, "go");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(go).not.toHaveBeenCalled();
  });
});
