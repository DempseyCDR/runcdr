// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AttendanceBreakdownView from "@/app/_components/AttendanceBreakdownView";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";

const labels = () =>
  within(screen.getByRole("region", { name: /attendance/i }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

/** Feature 079 (FR-022, FR-025, FR-033; contract §6): one breakdown, rendered the same on three screens. */
describe("AttendanceBreakdownView", () => {
  it("lists paying and children first, then the people who were not paying", () => {
    render(<AttendanceBreakdownView breakdown={BREAKDOWN()} />);
    expect(labels()).toEqual([
      "Paying 33",
      "Children 4",
      "Caller 1",
      "Band 3",
      "Door attendant 1",
      "Comps 4",
      "Gift cards 2",
    ]);
  });

  it("breaks the line after children", () => {
    render(<AttendanceBreakdownView breakdown={BREAKDOWN()} />);
    const lists = within(screen.getByRole("region", { name: /attendance/i })).getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(within(lists[0]!).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows sound tech and instructor only when one was checked in (FR-025)", () => {
    render(
      <AttendanceBreakdownView
        breakdown={BREAKDOWN({ performers: { caller: 1, band: 2, soundTech: 1, instructor: 1 } })}
      />,
    );
    expect(labels()).toContain("Sound tech 1");
    expect(labels()).toContain("Instructor 1");
    expect(labels().indexOf("Sound tech 1")).toBe(labels().indexOf("Band 2") + 1);
  });

  it("warns about each double booking, naming the performer and each kind (FR-033)", () => {
    render(
      <AttendanceBreakdownView
        breakdown={BREAKDOWN({
          doubleBookings: [
            { contactId: "c1", displayName: "Pat Fiddler", kinds: ["musician", "sound_tech"] },
          ],
        })}
      />,
    );
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(/Pat Fiddler/);
    expect(warning).toHaveTextContent(/musician/);
    expect(warning).toHaveTextContent(/sound tech/);
  });

  it("shows no warning when nothing is double booked", () => {
    render(<AttendanceBreakdownView breakdown={BREAKDOWN()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
