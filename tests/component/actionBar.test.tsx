// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ActionBar from "@/app/_components/ActionBar";

/** Feature 089 US3 (contracts/action-bar.md): one bar, the main action last. */
describe("ActionBar (089)", () => {
  it("is one group named Actions, holding the buttons in the order given (A1)", () => {
    render(
      <ActionBar>
        <button type="button">Close</button>
        <button type="button">Archive</button>
        <button type="button">Save</button>
      </ActionBar>,
    );
    const bar = screen.getByRole("group", { name: "Actions" });
    const names = within(bar)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(["Close", "Archive", "Save"]);
  });

  it("marks a page's pinned bar, and leaves a dialog's unmarked (A5)", () => {
    const { rerender } = render(
      <ActionBar pinned>
        <button type="button">Save</button>
      </ActionBar>,
    );
    expect(screen.getByRole("group", { name: "Actions" })).toHaveAttribute("data-pinned");

    rerender(
      <ActionBar>
        <button type="button">Save</button>
      </ActionBar>,
    );
    expect(screen.getByRole("group", { name: "Actions" })).not.toHaveAttribute("data-pinned");
  });
});
