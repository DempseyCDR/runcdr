# Data Model: Gate membership-level fix

**No schema change.** Everything below already exists; this records what the fix relies on.

## Gate sale (`gate_sales`, existing)

| Field | Notes |
|---|---|
| `category` | `membership`, `donation`, `future_event`, or an anonymous category |
| `payment_method` | `cash` or `card` |
| `amount_cents` | |
| `contact_id` | required on the three named categories |
| `membership_level` | `membership_level` enum (`individual`, `family`, `supporter`, `student`), since 0043. **Required** on a membership line and **forbidden** on any other — enforced by the route's schema, not the table |
| `note` | anonymous-sales comment |

Replace-all: each save deletes the door record's lines and inserts the ones sent. A membership line
therefore has to carry its level on every save, including one that only corrects a money figure.

## Membership account (`membership_accounts`, existing)

Opened or renewed at the sale's level by the same save, inside its transaction (feature 068). How an existing
account's level changes on renewal is unchanged.

## The page's named line (client state, changed)

```text
NamedLine
  category        donation | future_event | membership
  contactId
  contactName
  amount          text as typed
  paymentMethod   cash | card
  membershipLevel MembershipLevel | ""     ← NEW; "" = not chosen. Always "" off membership lines
```

- **Added** from search: `membershipLevel = ""`.
- **Reloaded**: `membershipLevel = sale.membershipLevel ?? ""`.
- **Sent**: `membershipLevel` included only when `category = membership`.
- **Guard**: a membership line with amount > 0 and `membershipLevel = ""` stops the save.
