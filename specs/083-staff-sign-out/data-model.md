# Data model: a sign-out control for staff

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## No schema change

This feature adds no table, no column and no migration. It reads what is already there and calls a route
that already exists. The latest migration stays `0055_gate_sale_quantity.sql`.

## What already exists

### `staff_sessions` (feature 015)

One row per signed-in device. The row is what "signed in" means: `readSession` validates it on every
request and re-checks `contacts.is_volunteer` live.

| Concern | Behaviour this feature depends on |
|---|---|
| Ending one session | `destroySession(db, token)` deletes **the row matching that token's hash** — one device, not the person's other devices (FR-008, and the out-of-scope note in the spec) |
| Already ended | No row matches, so nothing is deleted and nothing is logged; the caller still clears the cookie and redirects (the spec's "session that has already ended" edge case) |
| Audit | A delete writes `auth.signout` through the structured logger, at the same level as sign-in (FR-009, research R3) |

### `CurrentStaff` — what the app knows about who is signed in

Resolved per request by `getCurrentStaff()` / `getActor()`; never cached (feature 016, FR-014).

| Field | Used here |
|---|---|
| `displayName` | **Yes** — the name shown beside the control (FR-005) |
| `contactId` | No — the control ends the session it is holding, identified by the cookie |
| `identityId`, `email` | No — the email is deliberately not shown (research R4) |

## What the menu carries

`Nav` (server) → `VolunteerNav` (client presenter). The presenter receives data and renders it; it makes
no authorization decision, which is the rule feature 035 set for it.

| Prop | Type | Meaning |
|---|---|---|
| `items` | `NavItem[]` | Existing: the destinations this actor's capabilities permit |
| `signedInAs` | `string` | **New, required**: the display name of the volunteer whose session this device holds |

There is no client state: no toggle, no stored name, nothing in `localStorage`. The name is whatever the
server rendered for this request, and the control is a form.

## State transition

```text
signed in ──[volunteer submits Sign out]──> session row deleted, cookie cleared ──> public home page
     ▲                                                                                     │
     └──────────────────────────── [the usual sign-in] ◀───────────────────────────────────┘
```

Every other volunteer's session, and every record the volunteer made, are untouched by the transition
(FR-008).
