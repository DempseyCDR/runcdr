# Data model: The volunteer frame

**Feature**: 090-volunteer-frame | **Date**: 2026-09-30

**No stored data changes.** There is no migration, table or column. What follows is the shape of the
menu the server hands to the bar and the home page.

## A destination

| Field | Meaning |
|---|---|
| `href` | Where it goes. The organizer report's is now `/organizer` (R9) |
| `label` | What it says ("Gate report", not "Treasurer report") |
| `group` | One of `tonight · booking · reports · people · settings · website` |
| `capability` | What makes it appear (unchanged — feature 016); `null` means every volunteer |

The destinations and their groups:

| Group | Destinations |
|---|---|
| **tonight** | Check-in, Gate money, Payments |
| **booking** | Booking Central, Events, Venues |
| **reports** | Organizer report, Gate report |
| **people** | Contacts, Mailing-list exports |
| **settings** | Rate parameters, Admission pricing, Expense parameters, Door parameters, Access control, Route index |
| **website** | Content pages, Officers, Announcement, Campaigns |

## The menu: `menuFor(actor)`

```text
{ kind: "flat", items: Destination[] }                          — six or fewer destinations
{ kind: "grouped", groups: { key, label, items: Destination[] }[] } — more than six
```

**Rules** (spec FR-004, FR-005, FR-007):

- **Same destinations:** the destinations are exactly `navItemsFor(actor)`, in `NAV`'s order within
  each group.
- **Group order is fixed:** Tonight, Booking, Reports, People, Settings, Website.
- **Empty groups are dropped.** A group of one stays a group; the presenter draws it as a link.
- **Worked cases:**

| Who | Result |
|---|---|
| A Door Attendant (Check-in + the two open to everyone) | Flat, 3 destinations |
| The Financial Secretary (Check-in, Gate money, Payments, both reports, Contacts) | Flat, 6 destinations |
| The Treasurer | Grouped |
| A Super-user | Grouped (20) |

## The organizer landing: `organizerLandingKey(mySeriesIds, series)`

| Viewer | Lands on |
|---|---|
| Their grants name exactly one series | That series' key |
| Otherwise (none, several, or a club-wide grant) | `tnc`, today's default |

`mySeriesIds` comes from `mySeries(actor)`, lifted unchanged from `/api/me/capabilities` (feature
086).
