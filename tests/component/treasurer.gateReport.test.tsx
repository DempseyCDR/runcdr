// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import TreasurerReportPage from "@/app/(admin)/treasurer/page";
import { REPORT } from "./fixtures/treasurerReport";

afterEach(() => vi.unstubAllGlobals());

const EVENTS = [
  { id: "e_recent", eventDate: "2020-06-15", seriesId: "s1", startTime: "19:30:00", label: null },
];
const SERIES = [{ id: "s1", key: "tnc", name: "TNC" }];

function stub(over: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = async () => {
        const m = /\/events\/([^/]+)\/treasurer-report/.exec(u);
        if (m) return REPORT(m[1]!, over);
        if (u.includes("/api/series")) return { items: SERIES };
        if (u.includes("/api/events")) return { items: EVENTS };
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
}

async function open(over: Record<string, unknown> = {}) {
  stub(over);
  render(<TreasurerReportPage />);
  return screen.findByRole("article", { name: "Gate report" });
}

const line = (over: Record<string, unknown>) => ({
  quantity: null,
  level: null,
  members: [],
  name: null,
  for: null,
  cash: 0,
  check: 0,
  card: 0,
  notes: [],
  ...over,
});
const payment = (over: Record<string, unknown>) => ({
  checkNumber: null,
  cash: false,
  voided: false,
  notes: [],
  ...over,
});

/** The evening the P1 walk-through recorded, as the report returns it. */
const EVENING = {
  header: {
    date: "2020-06-15",
    startTime: "19:30:00",
    title: "Gatecheck Test",
    venue: "Faith Lutheran",
    band: null,
    musicians: ["Lead", "Piano"],
    caller: "Cal Caller",
    soundTech: "Sam Sound",
  },
  receipts: {
    lines: [
      line({ category: "merchandise", quantity: 3, cash: 75, notes: ["T-shirts"] }),
      line({ category: "future_event", name: "Jo Friend", cash: 15 }),
      line({
        category: "membership",
        name: "Dee Member",
        level: "family",
        members: ["Will Payer", "Finn Payer"],
        card: 40,
      }),
      line({ category: "admission", quantity: 2, name: "Chuck Writer", check: 30 }),
      line({
        category: "donation",
        name: "Chuck Writer",
        for: "Dee Member",
        check: 40,
        notes: ["for the sound fund", "covers Jo too"],
      }),
    ],
    admission: { cash: 420, card: 180 },
    totals: { cash: 510, check: 70, card: 220, total: 800 },
  },
  expenses: {
    payments: [
      payment({
        role: "sound_tech",
        payee: "Sam Sound",
        checkNumber: "1501",
        amount: 60,
        voided: true,
        notes: ["Void — torn"],
      }),
      payment({
        role: "caller",
        payee: "Cal Caller",
        checkNumber: "1502",
        amount: 240,
        notes: ["booked $175.00 · paid $150.00", "also pays Eve Later $90.00 (2020-06-08)"],
      }),
      payment({ role: "sound_tech", payee: "Sam Sound", cash: true, amount: 60 }),
    ],
    otherPaidOut: { amount: 20, reason: "ice" },
    totals: { check: 240, cash: 80, total: 320 },
    rent: { vendor: "Faith Lutheran Church", amount: 250, unpaid: true },
    reconciliation: { booked: 520, paid: 460, outstanding: 60 },
  },
  card: { gross: 180, transactions: 9, fee: 4.93 },
  deposits: [
    {
      kind: "main",
      amount: 475,
      makeUp: { countedCash: 500, seedFloat: 15, otherPaidOut: 20, performerCash: 60, checks: 70 },
    },
    { kind: "check", checkId: "k-big", writer: "Big Donor", amount: 500 },
  ],
  eveningNote: "the ice ran out at 9",
  paidElsewhere: [{ performer: "Pat Piano", amount: 80, eventDate: "2020-06-22" }],
  paidTonightForEarlier: [{ performer: "Eve Later", amount: 90, eventDate: "2020-06-08" }],
  recordedBy: { gateMoney: "Mary Fs", performerPayments: "Mary Fs" },
};

const rows = (name: string) =>
  within(screen.getByRole("table", { name }))
    .getAllByRole("row")
    .map((r) => r.textContent);

/** Feature 082 (research R18, R19 — the P1 review): the gate report laid out as the paper one. */
describe("the gate report", () => {
  it("is one region that prints, with Print", async () => {
    const report = await open(EVENING);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Gate report");
    expect(report).toHaveAttribute("data-printable-report");
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  it("heads the report with the evening, whose it was, who recorded it and who came", async () => {
    await open(EVENING);
    const header = within(screen.getByRole("group", { name: "The evening" }));
    expect(header.getByText(/^2020-06-15/)).toHaveTextContent(
      "2020-06-15 7:30 PM · Gatecheck Test · Faith Lutheran · Lead, Piano · caller Cal Caller · sound Sam Sound",
    );
    expect(header.getByText(/^Recorded by/)).toHaveTextContent("Recorded by Mary Fs");
    const attendance = header.getByRole("region", { name: "Attendance" });
    expect(attendance).toHaveTextContent(/Paying 21/);
    expect(header.getByText("Total 42")).toBeInTheDocument();
  });

  it("names the band when one was booked", async () => {
    await open({ ...EVENING, header: { ...EVENING.header, band: "The Trio", musicians: [] } });
    expect(screen.getByRole("group", { name: "The evening" })).toHaveTextContent(
      "Faith Lutheran · The Trio · caller",
    );
  });

  it("lists the receipts: qty, name, cash, check, card, each note beneath its line, admission, total", async () => {
    await open(EVENING);
    expect(rows("Receipts")).toEqual([
      "QtyNameCashCheckCard",
      "3Merchandise$75.00",
      "T-shirts",
      "Future event — Jo Friend$15.00",
      "Membership (family) — Dee Member, with Will Payer and Finn Payer$40.00",
      "2Admission — Chuck Writer$30.00",
      "Donation — Chuck Writer, for Dee Member$40.00",
      "for the sound fund",
      "covers Jo too",
      "Admission$420.00$180.00",
      "Totals$510.00$70.00$220.00",
      "Total receipts$800.00",
    ]);
  });

  it("starts a receipt's note where the name starts, and runs it to the end of the line", async () => {
    await open(EVENING);
    const shirts = within(screen.getByRole("table", { name: "Receipts" }))
      .getAllByRole("row")
      .find((r) => r.textContent === "T-shirts")!;
    const cells = within(shirts).getAllByRole("cell");
    // An empty cell under Qty, then the note across Name, Cash, Check and Card.
    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveTextContent("");
    expect(cells[1]).toHaveAttribute("colspan", "4");
  });

  it("lists the expenses: role, name, check # or cash, amount, voids and notes beneath, totals, rent unpaid", async () => {
    await open(EVENING);
    expect(rows("Expenses")).toEqual([
      "RoleNameCheck #Amount",
      "Sound techSam Sound1501$60.00",
      "Void — torn",
      "CallerCal Caller1502$240.00",
      "booked $175.00 · paid $150.00",
      "also pays Eve Later $90.00 (2020-06-08)",
      "Sound techSam Soundcash$60.00",
      "Other cash paid outcash$20.00",
      "ice",
      "Totalschecks $240.00 · cash $80.00$320.00",
      "RentFaith Lutheran Churchunpaid$250.00",
      "Performersbooked $520.00 · paid $460.00outstanding$60.00",
    ]);
  });

  // Feature 085 (FR-008): "did we pay everyone?" — the one question the per-payment notes cannot answer.
  it("shows the booked-versus-paid reconciliation, and shows it when nothing is outstanding", async () => {
    await open({
      ...EVENING,
      expenses: {
        ...EVENING.expenses,
        reconciliation: { booked: 460, paid: 460, outstanding: 0 },
      },
    });
    expect(rows("Expenses")).toContain("Performersbooked $460.00 · paid $460.00outstanding$0.00");
  });

  it("sets receipts and expenses side by side, with deposits under receipts and notes under expenses", async () => {
    await open(EVENING);
    const [left, right] = screen.getAllByRole("group").filter((g) => g.dataset.column);
    expect(within(left!).getByRole("table", { name: "Receipts" })).toBeInTheDocument();
    expect(within(left!).getByRole("region", { name: "Deposits" })).toBeInTheDocument();
    expect(within(right!).getByRole("table", { name: "Expenses" })).toBeInTheDocument();
    expect(within(right!).getByRole("region", { name: "Notes" })).toBeInTheDocument();
  });

  it("lists each deposit with what makes it up, and the card", async () => {
    await open(EVENING);
    const deposits = within(screen.getByRole("region", { name: "Deposits" }));
    const main = deposits.getByRole("listitem", { name: "Main deposit" });
    expect(main).toHaveTextContent("$475.00");
    expect(main).toHaveTextContent(
      "counted cash $500.00, less cash box seed $15.00, less paid out $20.00, less performers $60.00, plus checks $70.00",
    );
    expect(deposits.getByRole("listitem", { name: "Check from Big Donor" })).toHaveTextContent(
      "$500.00",
    );
    expect(deposits.getByText("Card: gross $180.00 · 9 transactions · fee $4.93")).toBeTruthy();
  });

  it("puts the evening's note and the bookings paid at another evening in the notes", async () => {
    await open(EVENING);
    const notes = within(screen.getByRole("region", { name: "Notes" }));
    expect(notes.getByText("the ice ran out at 9")).toBeInTheDocument();
    expect(notes.getByText("Pat Piano — $80.00 — paid at the 2020-06-22 event")).toBeTruthy();
    expect(
      notes.getByText("Eve Later — $90.00 — for the 2020-06-08 event, paid tonight"),
    ).toBeTruthy();
  });

  it("shows no QuickBooks class or customer", async () => {
    await open(EVENING);
    expect(screen.queryByText(/class|customer|QBO/i)).toBeNull();
  });

  it("says so plainly where a part is empty, never an empty table", async () => {
    await open();
    const expenses = within(screen.getByRole("region", { name: "Expenses" }));
    expect(expenses.queryByRole("table")).toBeNull();
    expect(expenses.getByText("None")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Notes" })).getByText("None")).toBeTruthy();
    expect(screen.getByRole("group", { name: "The evening" })).toHaveTextContent(
      "Recorded by no one yet",
    );
  });
});
