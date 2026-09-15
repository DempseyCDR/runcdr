import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { bands, events, miscExpenses, series } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { centsToDollars } from "@/server/lib/money";
import { computeEventGate } from "@/server/domain/gate/eventMoney";
import { getBookingsForEvent } from "@/server/domain/bookings/bookingService";
import { settledCentsByBookingForEvent } from "@/server/domain/payments/performerPaymentService";
import { resolveOngoingTotalCents } from "@/server/domain/parameters/seriesParameterService";
import { resolveEventRentCents } from "@/server/domain/parameters/rentService";
import { avgTicketCents, breakEvenDancers, danceNetCents } from "./danceResult";
import { getAttendanceBreakdown } from "@/server/domain/attendance/breakdownService";
import { quarterlySummary, type QuarterlyRow } from "./quarterly";
import { buildTrend, type TrendPoint } from "./trend";

export type OrganizerReport = {
  series: { key: string; name: string };
  perDanceRows: unknown[];
  quarterlySummary: ReturnType<typeof quarterlySummary>;
  trend: ReturnType<typeof buildTrend>;
};

/** Series included in a report: the TNC report also includes its Community Dance events (FR-001). */
function includedKeys(seriesKey: string): string[] {
  return seriesKey === "tnc" ? ["tnc", "community_dance"] : [seriesKey];
}

export async function assembleOrganizerReport(
  db: Db,
  seriesKey: string,
  year: number,
): Promise<OrganizerReport> {
  const primary = await db.query.series.findFirst({ where: eq(series.key, seriesKey) });
  if (!primary) throw errors.seriesNotFound();

  const seriesRows = await db
    .select()
    .from(series)
    .where(inArray(series.key, includedKeys(seriesKey)));
  const seriesById = new Map(seriesRows.map((s) => [s.id, s]));
  const seriesIds = seriesRows.map((s) => s.id);

  const eventRows = (
    await db.select().from(events).where(inArray(events.seriesId, seriesIds))
  ).sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  // Feature 041 (P6-R11): resolve a booked band's NAME for the band column. Load a bandId→name map once
  // (bands is a small table) rather than per event, avoiding an N+1 across a full-year report.
  const bandRows = await db.select({ id: bands.id, name: bands.name }).from(bands);
  const bandNameById = new Map(bandRows.map((b) => [b.id, b.name]));

  const rows = [];
  const quarterlyRows: QuarterlyRow[] = [];
  const trendPoints: TrendPoint[] = [];

  for (const ev of eventRows) {
    const gate = await computeEventGate(db, ev.id);
    const { bookings } = await getBookingsForEvent(db, ev.id);
    // Feature 023 (FR-009): performer cost by incurred date = the actual settled amount for a paid booking,
    // else the booking's expected pay (still-outstanding) — a single combined figure. A delayed check's
    // amount lands here via the booking's event (settledCentsByBookingForEvent keys on booking → event).
    const settled = await settledCentsByBookingForEvent(db, ev.id);
    const costForBookingCents = (b: (typeof bookings)[number]) => settled.get(b.id) ?? b.payCents;
    const performerTotalCents = bookings.reduce((a, b) => a + costForBookingCents(b), 0);
    // Feature 079 (FR-028): paying dancers are the attendance breakdown's — performers subtracted only when
    // checked in, comps including open-band musicians — the same figure the door, gate and treasurer show.
    const dancers = (await getAttendanceBreakdown(db, ev.id)).paying;

    const rentCents = await resolveEventRentCents(db, ev);
    const ongoingCents = await resolveOngoingTotalCents(db, ev.seriesId, ev.eventDate);
    const miscRows = await db.select().from(miscExpenses).where(eq(miscExpenses.eventId, ev.id));
    const miscCents = miscRows.reduce((a, m) => a + m.amountCents, 0) + gate.cardFeeCents;

    const net = danceNetCents({
      admissionCents: gate.admissionCents,
      merchandiseCents: gate.merchandiseCents,
      rentCents,
      performerTotalCents,
      ongoingCents,
      miscCents,
    });
    const avgTicket = avgTicketCents(gate.admissionCents, dancers);

    const caller = bookings.find((b) => b.performerType === "caller")?.performerName ?? "";
    const musicianBookings = bookings.filter(
      (b) => b.performerType === "lead_musician" || b.performerType === "musician",
    );
    // Feature 041 (P6-R11): show the booked BAND's name when the musicians belong to a named band; else the
    // joined member names (ad-hoc); else "Open Band"; else "". Distinct non-null bandIds → their names joined.
    const bandIds = [
      ...new Set(musicianBookings.filter((b) => b.bandId !== null).map((b) => b.bandId as string)),
    ];
    const band =
      bandIds.length > 0
        ? bandIds.map((id) => bandNameById.get(id) ?? "").join(", ")
        : musicianBookings.length > 0
          ? musicianBookings.map((b) => b.performerName).join(", ")
          : bookings.some((b) => b.performerType === "open_band_musician")
            ? "Open Band"
            : "";

    const srow = seriesById.get(ev.seriesId);
    rows.push({
      eventId: ev.id,
      date: ev.eventDate,
      series: srow?.key ?? "",
      caller,
      band,
      dancers,
      grossGate: centsToDollars(gate.admissionCents),
      merchandise: centsToDollars(gate.merchandiseCents),
      rent: centsToDollars(rentCents),
      performerTotal: centsToDollars(performerTotalCents), // combined actual-paid + outstanding (023)
      ongoingExpense: centsToDollars(ongoingCents),
      miscExpenses: centsToDollars(miscCents),
      danceNet: centsToDollars(net),
      danceNetNegative: net < 0,
      avgTicket: centsToDollars(avgTicket),
      breakEvenDancers: breakEvenDancers(net, avgTicket),
      performers: bookings.map((b) => ({
        name: b.performerName,
        type: b.performerType,
        amount: centsToDollars(costForBookingCents(b)),
      })),
      fyi: {
        donations: centsToDollars(gate.donationCents),
        memberships: centsToDollars(gate.membershipCents),
        futureEvent: centsToDollars(gate.futureEventCents),
        giftCards: centsToDollars(gate.giftCardCents),
        miscSales: centsToDollars(gate.miscSalesCents),
      },
    });

    quarterlyRows.push({
      date: ev.eventDate,
      dancers,
      gross: centsToDollars(gate.admissionCents),
      merchandise: centsToDollars(gate.merchandiseCents),
      rent: centsToDollars(rentCents),
      performerTotal: centsToDollars(performerTotalCents),
      ongoing: centsToDollars(ongoingCents),
      misc: centsToDollars(miscCents),
      danceNet: centsToDollars(net),
      avgTicket: centsToDollars(avgTicket),
      fyi: {
        donations: centsToDollars(gate.donationCents),
        memberships: centsToDollars(gate.membershipCents),
        futureEvent: centsToDollars(gate.futureEventCents),
        giftCards: centsToDollars(gate.giftCardCents),
        miscSales: centsToDollars(gate.miscSalesCents),
      },
    });

    trendPoints.push({ date: ev.eventDate, danceNet: centsToDollars(net), dancers, caller, band });
  }

  return {
    series: { key: primary.key, name: primary.name },
    perDanceRows: rows,
    quarterlySummary: quarterlySummary(quarterlyRows, year),
    trend: buildTrend(trendPoints),
  };
}
