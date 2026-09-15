# Contract: Mobile door check-in

**Feature**: 079-mobile-door-checkin | **Spec**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md)

Errors use the app's existing shape: `{ "error": { "code": "…", "message": "…", "details"?: {…} } }`.

## 1. Search — extended

```http
GET /api/attendance/search?q={query}&eventId={eventId}
```

`requires: "base"`, as today. `eventId` is optional; without it `checkedIn` is omitted.

```jsonc
{
  "items": [
    {
      "id": "…",
      "displayName": "DJ",
      "firstName": "David",               // NEW — names are not PII
      "lastName": "Jones",                // NEW
      "displayNameOverride": "DJ",        // NEW — non-null means the display name is custom
      "membershipStatus": "current",
      "checkedIn": false,                 // NEW — present when eventId was given
      "emails": ["dj@example.com"],       // CHANGED: active or transition only, personal first; [] without PII
      "reachedVia": {                     // NEW — null unless the contact rides a household address
        "ownerDisplayName": "Ann Jones",
        "address": "jones@example.com"    // null without PII
      }
    }
  ],
  "truncated": false
}
```

## 2. Check in — extended

```http
POST /api/events/{eventId}/attendance
```

`requires: "attendance.write"`, as today. Body shapes are unchanged except the new-contact one:

```jsonc
{
  "newContact": {
    "firstName": "Sam", "lastName": "Reel", "displayNameOverride": "…",
    "email": "jones@example.com", "phone": "…",
    "shareEmail": true                    // NEW, optional — see below
  },
  "childrenCount": 2, "isComp": true, "redeemedGiftCard": false, "isOpenBand": false
}
```

**409 `EMAIL_ACTIVE_ELSEWHERE`** — `email` is active or in transition on another contact and `shareEmail`
is absent. **Nothing is created.** `error.other` names the owner, as feature 066 already returns it:

```jsonc
{ "error": { "code": "EMAIL_ACTIVE_ELSEWHERE", "message": "Already active on Ann Jones — …",
             "other": { "contactId": "…", "displayName": "Ann Jones", "emailId": "…" } } }
```

**201 with `shareEmail: true`** — the contact is created owning no address, linked to the owner's email as
its message recipient, and checked in, in one transaction.

**409 `ALREADY_CHECKED_IN`** — as today, and now also when two check-ins of one contact race to the
database.

Choosing "that person" is an ordinary check-in by `contactId`. Choosing "a mistake" sends nothing.

## 3. Attendance breakdown — new

```http
GET /api/events/{eventId}/attendance-breakdown
```

`requires: "base"`. **404 `EVENT_NOT_FOUND`** for an unknown event.

```jsonc
{
  "attendance": 42,
  "paying": 33,
  "children": 4,
  "performers": { "caller": 1, "band": 3, "soundTech": 1, "instructor": 0 },
  "doorAttendant": 1,
  "comps": 4,
  "giftCards": 2,
  "doubleBookings": [
    { "contactId": "…", "displayName": "Pat Fiddler", "kinds": ["musician", "sound_tech"] }
  ]
}
```

## 4. Treasurer report — extended

```http
GET /api/events/{eventId}/treasurer-report
```

Gains `"attendance": { …the breakdown of §3… }`. Existing fields are unchanged.

## 5. Roster — extended

```http
GET /api/events/{eventId}/attendance?sort=display|first|last
```

`display` is new (display name, then first, then last). The default stays `last`. Each attendee gains
`displayNameOverride`.

## 6. UI contract — the check-in page (`/checkin`)

Top to bottom, on a phone:

1. **Event** — date, series, start time, label; **Change** reveals the event selector; a warning when the
   date is not the device's local date.
2. **Search box** — focused on load and after every check-in; Enter checks in the top result unless it is
   checked in.
3. **Extras row** — children, comp, gift card, and open band at a community dance only. Applies to the next
   check-in; resets after a successful one.
4. **Check in anonymously** — disabled while open band is ticked.
5. **Add contact** · **Show checked in**.
6. **Results** — `ContactName`, addresses or "reached via …", and **Check in** or a checkmark.

**Add contact dialog**: first name, last name, display name (optional), email, phone; "With: …" summary of
the extras row; up to five "did you mean" matches, each with Check in; on `EMAIL_ACTIVE_ELSEWHERE`, three
choices — *It's {owner}* · *Different person sharing it* · *Fix the email*.

**Checked-in dialog**: `AttendanceBreakdownView` at the top; sort control *Display name* (default) · *First* ·
*Last*; the list; a row opens the existing correction dialog.

**`AttendanceBreakdownView`** (also at the top of `/treasurer` and `/gate`): a wrapping horizontal list —
*Paying · Children*, a line break, *Caller · Band · Sound tech · Instructor · Door attendant · Comps · Gift
cards* — with sound tech and instructor only when non-zero, and one warning line per double booking.
