// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VenueForm from "@/app/(admin)/venues/VenueForm";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

function stub(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "v1", items: [] }),
      };
    }),
  );
  return calls;
}

const GRANGE = {
  id: "v1",
  name: "Grange Hall",
  shortName: "GH",
  address: "1 Main St",
  directions: "Park behind the hall",
  isPublic: true,
  latitude: null,
  longitude: null,
  landlordContactId: null,
  landlordName: null,
  archivedAt: null,
};

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

/**
 * Feature 084 US1 (FR-001 to FR-003, FR-028): one form creates and edits a venue. Nothing the record
 * holds is write-once, and a save carries only what changed.
 */
describe("VenueForm", () => {
  it("offers every field the venue holds, filled in, when editing", () => {
    stub();
    render(<VenueForm venue={GRANGE} onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Grange Hall");
    expect(screen.getByLabelText("Short name")).toHaveValue("GH");
    expect(screen.getByLabelText("Address")).toHaveValue("1 Main St");
    expect(screen.getByLabelText("Directions")).toHaveValue("Park behind the hall");
    expect(screen.getByRole("checkbox", { name: "Shown on the public site" })).toBeChecked();
  });

  it("offers the same fields, empty, when creating", () => {
    stub();
    render(<VenueForm onSaved={() => {}} onClose={() => {}} />);
    for (const label of ["Name", "Short name", "Address", "Directions"]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
  });

  it("sends only the field that changed (FR-028)", async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<VenueForm venue={GRANGE} onSaved={() => {}} onClose={() => {}} />);

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Grange Hall Annexe");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.method).toBe("PATCH");
    expect(writes(calls)[0]!.url).toContain("/api/venues/v1");
    expect(writes(calls)[0]!.body).toEqual({ name: "Grange Hall Annexe" });
  });

  it("creates with what was filled in", async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<VenueForm onSaved={() => {}} onClose={() => {}} />);
    await user.type(screen.getByLabelText("Name"), "New Hall");
    await user.type(screen.getByLabelText("Address"), "2 Side St");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.method).toBe("POST");
    expect(writes(calls)[0]!.body).toMatchObject({ name: "New Hall", address: "2 Side St" });
  });

  it("changes the landlord, sending only that (FR-001)", async () => {
    const calls = stub();
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (String(url).includes("/api/contacts"))
          return {
            ok: true,
            status: 200,
            json: async () => ({ items: [{ id: "c-len", displayName: "Len Landlord" }] }),
          };
        return { ok: true, status: 200, json: async () => ({ id: "v1" }) };
      }),
    );
    render(<VenueForm venue={GRANGE} onSaved={() => {}} onClose={() => {}} />);

    await user.type(screen.getByLabelText("Search a contact"), "Len");
    await user.click(await screen.findByRole("button", { name: "Set as landlord" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ landlordContactId: "c-len" });
  });

  it("shows the venue read-only to someone who may not change it (FR-003)", () => {
    stub();
    render(<VenueForm venue={GRANGE} readOnly onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Address")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
