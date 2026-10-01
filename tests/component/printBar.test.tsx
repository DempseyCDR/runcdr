// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PrintBar from "@/app/_components/PrintBar";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1";

/**
 * Feature 090 (FR-023, research R10): one Print for both reports — the gate report's, moved here. Safari on
 * the iPhone cannot print a report as landscape letter (feature 089, B67), so a note stands in for Print.
 */
describe("PrintBar (090)", () => {
  it("offers Print in a pinned action bar, which prints", () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<PrintBar />);
    const bar = screen.getByRole("group", { name: "Actions" });
    expect(bar).toHaveAttribute("data-pinned");
    within(bar).getByRole("button", { name: "Print" }).click();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("shows the note in its place on Safari on the iPhone", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE_SAFARI);
    render(<PrintBar />);
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
    expect(screen.getByText(/print it from Chrome or a computer/i)).toBeInTheDocument();
  });

  it("offers Print in Chrome on the iPhone", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE_CHROME);
    render(<PrintBar />);
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  });
});
