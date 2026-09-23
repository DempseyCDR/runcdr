import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import {
  bandMembers,
  bands,
  contactEmails,
  contacts,
  doorRecords,
  eventGroups,
  events,
  membershipAccounts,
  membershipMembers,
  performers,
  series,
  seriesParameters,
  venues,
  venueRents,
} from "@/server/db/schema";
import { deriveContactNames } from "@/server/domain/contacts/normalize";
import { recomputeContactStatus } from "@/server/domain/membership/membershipService";
import type { EmailConsentTopic } from "@/server/db/schema";

/**
 * Seed a realistic fixture: ~1,300 contacts and ~152 members. Used for manual
 * validation and to exercise fuzzy-search performance (SC-005). Idempotent-ish:
 * truncates the feature tables first.
 */
const FIRST = [
  "Ada",
  "Grace",
  "Alan",
  "Katherine",
  "Dorothy",
  "Edsger",
  "Donald",
  "Barbara",
  "Tim",
  "Margaret",
];
const LAST = [
  "Lovelace",
  "Hopper",
  "Turing",
  "Johnson",
  "Vaughan",
  "Dijkstra",
  "Knuth",
  "Liskov",
  "Berners-Lee",
  "Hamilton",
];

async function main() {
  await sql`TRUNCATE mailing_list_exports, misc_expenses, series_parameters, series_parameter_audit, venue_rents, venue_rent_audit, band_members, bands, door_record_audit, gate_sales, door_records, attendance, quarterly_attendance_counts, events, event_groups, venues, merge_audit, status_change_audit, membership_members, membership_accounts, contact_emails, contacts RESTART IDENTITY CASCADE`;

  // Series (config) — idempotent.
  await db
    .insert(series)
    .values([
      { key: "tnc", name: "Thursday Night Contra", hasSoundTech: true },
      { key: "ecd", name: "Sunday English Country Dance", hasSoundTech: true },
      { key: "community_dance", name: "Community Dance", hasSoundTech: false },
      { key: "general", name: "General / Joint Events", hasSoundTech: true },
    ])
    .onConflictDoNothing({ target: series.key });

  const total = 1300;
  const ids: string[] = [];
  for (let i = 0; i < total; i += 500) {
    const batch = Array.from({ length: Math.min(500, total - i) }, (_, j) => {
      const n = i + j;
      const firstName = FIRST[n % FIRST.length]!;
      const lastName = `${LAST[(n * 7) % LAST.length]!} ${n}`;
      return { firstName, lastName, ...deriveContactNames({ firstName, lastName }) };
    });
    const inserted = await db.insert(contacts).values(batch).returning({ id: contacts.id });
    ids.push(...inserted.map((r) => r.id));
  }

  // Emails for everyone.
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500).map((id, k) => ({
      contactId: id,
      email: `contact${i + k}@example.com`,
    }));
    await db.insert(contactEmails).values(batch);
  }

  // ~152 members with future expiry.
  const memberIds = ids.slice(0, 152);
  for (const id of memberIds) {
    // Feature 068: each seeded member pays for their own individual account and is attached to it.
    const [account] = await db
      .insert(membershipAccounts)
      .values({ payerContactId: id, level: "individual", expiryDate: "2030-12-31" })
      .returning();
    await db.insert(membershipMembers).values({ accountId: account!.id, contactId: id });
    await recomputeContactStatus(db, id, "membership_change", null);
  }

  // A sample venue (feature 007) for the public site.
  const [venue] = await db
    .insert(venues)
    .values({
      name: "German House",
      address: "315 Gregory St, Rochester, NY",
      latitude: 43.1417,
      longitude: -77.6062,
    })
    .returning();

  // A sample event + door record for manual validation, assigned the sample venue.
  const tnc = await db.query.series.findFirst({ where: eq(series.key, "tnc") });
  if (tnc) {
    const [evt] = await db
      .insert(events)
      .values({
        seriesId: tnc.id,
        eventDate: "2026-06-18",
        chargesAdmission: true,
        venueId: venue?.id ?? null,
        startTime: "19:30",
        description: "Contra with a live band and a friendly caller — beginners welcome.",
      })
      .returning();
    // comp_count (feature 014): two people admitted free, so dev data exercises the paying-dancer subtraction.
    if (evt) await db.insert(doorRecords).values({ eventId: evt.id, compCount: 2 });

    // A same-day double dance (feature 013): two labeled events in one group on one date.
    const [doubleDance] = await db
      .insert(eventGroups)
      .values({ name: "Pride Dance 2026", kind: "double dance" })
      .returning();
    if (doubleDance) {
      await db.insert(events).values([
        {
          seriesId: tnc.id,
          eventDate: "2026-06-27",
          chargesAdmission: true,
          venueId: venue?.id ?? null,
          groupId: doubleDance.id,
          label: "Afternoon",
          startTime: "14:00",
        },
        {
          seriesId: tnc.id,
          eventDate: "2026-06-27",
          chargesAdmission: true,
          venueId: venue?.id ?? null,
          groupId: doubleDance.id,
          label: "Evening",
          startTime: "19:30",
        },
      ]);
    }
  }

  // Sample contacts for feature 006 (iContact export) manual testing — one per consent topic.
  const topicSamples: { name: string; email: string; topics: EmailConsentTopic[] }[] = [
    { name: "Contra Fan", email: "contra.fan@example.com", topics: ["contra"] },
    { name: "English Fan", email: "english.fan@example.com", topics: ["english"] },
    { name: "Openband Fan", email: "openband.fan@example.com", topics: ["openband"] },
    {
      name: "Special Events Fan",
      email: "specialevents.fan@example.com",
      topics: ["special_events"],
    },
    { name: "Jane Austen Fan", email: "jab.fan@example.com", topics: ["jane_austen_ball"] },
    { name: "Tracing Willing", email: "tracing.willing@example.com", topics: ["contact_tracing"] },
    { name: "Opted Out", email: "opted.out@example.com", topics: ["do_not_contact"] },
  ];
  for (const s of topicSamples) {
    const [contact] = await db
      .insert(contacts)
      .values({ firstName: s.name, ...deriveContactNames({ firstName: s.name }) })
      .returning();
    if (contact) {
      await db.insert(contactEmails).values({
        contactId: contact.id,
        email: s.email,
        consentTopics: s.topics,
      });
    }
  }

  // Demo contacts exercising structured names (feature 012): a nickname override + pronouns, and a
  // mononym with no last name.
  await db.insert(contacts).values([
    {
      firstName: "Robert",
      lastName: "Frost",
      displayNameOverride: "Bob Frost",
      pronouns: "he/him",
      ...deriveContactNames({
        firstName: "Robert",
        lastName: "Frost",
        displayNameOverride: "Bob Frost",
      }),
    },
    { firstName: "Cher", pronouns: "she/her", ...deriveContactNames({ firstName: "Cher" }) },
  ]);

  // Jane Austen Ball demo event group + event (feature 010: kind is now a free-text category).
  const [jabGroup] = await db
    .insert(eventGroups)
    .values({ name: "Jane Austen Ball 2026", kind: "jane austen ball" })
    .returning();
  if (jabGroup && tnc) {
    await db.insert(events).values({
      seriesId: tnc.id,
      eventDate: "2026-03-14",
      chargesAdmission: true,
      groupId: jabGroup.id,
    });
  }

  // Performers.
  await db
    .insert(performers)
    .values([
      { displayName: "Sample Caller", bio: "Calls contras." },
      { displayName: "Sample Sound Tech" },
    ]);

  // Sample bands (feature 008) from a few musician performers.
  const bandPerformers = await db
    .insert(performers)
    .values([
      { displayName: "Fiona Fiddle", bio: "Fiddler." },
      { displayName: "Danny Drums" },
      { displayName: "Petra Piano" },
    ])
    .returning({ id: performers.id });
  if (bandPerformers.length === 3) {
    const [band] = await db
      .insert(bands)
      .values({ name: "The Contra Rebels", bio: "A high-energy contra band." })
      .returning();
    if (band) {
      await db.insert(bandMembers).values([
        { bandId: band.id, performerId: bandPerformers[0]!.id, isLead: true },
        { bandId: band.id, performerId: bandPerformers[1]!.id, isLead: false },
        { bandId: band.id, performerId: bandPerformers[2]!.id, isLead: false },
      ]);
    }
  }

  const allSeries = await db.select().from(series);

  // Sample series-scoped rates + ongoing charges per series (features 009/011). Rent lives in
  // venue_rents now (below), not series_parameters. Two concurrent ongoing charges demonstrate the
  // multi-charge model (feature 011).
  for (const srow of allSeries) {
    await db.insert(seriesParameters).values([
      {
        category: "rate",
        seriesId: srow.id,
        kind: "caller",
        amountCents: 15000,
        effectiveDate: "2026-01-01",
      },
      {
        category: "rate",
        seriesId: srow.id,
        kind: "sound_tech",
        amountCents: 10000,
        effectiveDate: "2026-01-01",
      },
      {
        category: "rate",
        seriesId: srow.id,
        kind: "musician",
        amountCents: 7500,
        effectiveDate: "2026-01-01",
      },
      {
        category: "expense",
        seriesId: srow.id,
        kind: "ongoing",
        amountCents: 1500,
        label: "Supplies/insurance",
        effectiveDate: "2026-01-01",
      },
      {
        category: "expense",
        seriesId: srow.id,
        kind: "ongoing",
        amountCents: 5000,
        label: "Equipment loan",
        effectiveDate: "2026-01-01",
      },
    ]);
  }

  // Venue rents (feature 011): a venue default plus a series-at-venue override for TNC.
  if (venue) {
    await db.insert(venueRents).values([
      { venueId: venue.id, seriesId: null, amountCents: 8000, effectiveDate: "2026-01-01" },
      ...(tnc
        ? [
            {
              venueId: venue.id,
              seriesId: tnc.id,
              amountCents: 7500,
              effectiveDate: "2026-01-01",
            },
          ]
        : []),
    ]);
  }

  console.log(
    `seeded ${ids.length} contacts, ${memberIds.length} members, series + sample event, performers + rates + ongoing charges + venue rents`,
  );
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
