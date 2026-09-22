// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArchiveControl from "@/app/(admin)/ArchiveControl";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; body: Record<string, unknown> | undefined };

/** The server refuses the first archive with 409 (in use), and accepts anything confirmed. */
function stub(inUse: boolean): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(url), body });
      if (inUse && !body?.confirm) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: {
              code: "STILL_IN_USE",
              message:
                "Grange Hall still has 3 dates to come, the next on 2026-10-08. Archive anyway?",
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }),
  );
  return calls;
}

/** Feature 084 (FR-010, FR-012, FR-014): retiring a record, and putting it back. */
describe("ArchiveControl", () => {
  it("archives at once when nothing is booked", async () => {
    const calls = stub(false);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <ArchiveControl
        base="/api/venues/v1"
        what="Grange Hall"
        archived={false}
        onChanged={onChanged}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(calls[0]!.url).toBe("/api/venues/v1/archive");
    expect(calls[0]!.body).toEqual({});
  });

  it("asks first when dates are still to come, then proceeds on confirmation (FR-014)", async () => {
    const calls = stub(true);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <ArchiveControl
        base="/api/venues/v1"
        what="Grange Hall"
        archived={false}
        onChanged={onChanged}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "still has 3 dates to come, the next on 2026-10-08",
    );
    expect(onChanged).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Archive anyway" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(calls.at(-1)!.body).toEqual({ confirm: true });
  });

  it("keeps it when the question is declined", async () => {
    stub(true);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <ArchiveControl
        base="/api/venues/v1"
        what="Grange Hall"
        archived={false}
        onChanged={onChanged}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(await screen.findByRole("button", { name: "Keep it" }));

    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("offers a restore for something already archived (FR-012)", async () => {
    const calls = stub(false);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <ArchiveControl base="/api/performers/p1" what="Pat Caller" archived onChanged={onChanged} />,
    );

    expect(screen.getByText("Archived.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(calls[0]!.url).toBe("/api/performers/p1/restore");
  });
});
