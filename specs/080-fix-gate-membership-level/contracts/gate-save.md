# Contract: the gate save

No route changes. This records the two existing routes as the page now uses them, and the page's contract.

## `POST /api/events/{id}/door-record` (open or reload) — unchanged

Returns `{ doorRecord, gateSales }`. Each `gateSales[]` item carries every stored column plus `contactName`,
including:

```json
{ "category": "membership", "paymentMethod": "card", "amountCents": 4000,
  "contactId": "…", "contactName": "Jane Doe", "membershipLevel": "family", "note": null }
```

## `PUT /api/door-records/{id}/gate-sales` — unchanged, `gate.write`

Request:

```json
{ "sales": [
  { "category": "membership", "paymentMethod": "card", "amount": 40,
    "contactId": "…", "membershipLevel": "family" },
  { "category": "donation", "paymentMethod": "cash", "amount": 10, "contactId": "…" },
  { "category": "merchandise", "paymentMethod": "cash", "amount": 12, "note": "3 CDs" }
] }
```

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ sales, enrolled: [{ contactId, displayName, expiryDate }] }` | all lines replaced; memberships recorded |
| 422 | `{ error: { code: "VALIDATION_ERROR", message } }` | nothing written |
| 403 | `{ error: { … } }` | not the gate writer for this event; nothing written |
| 404 | `{ error: { code: "DOOR_RECORD_NOT_FOUND", … } }` | nothing written |

## `PATCH /api/door-records/{id}` — unchanged, `gate.write`

Money figures. 200 returns `{ deposit, … }`; a refusal returns the same error envelope.

## Page contract (`/gate`)

| Element | Contract |
|---|---|
| Level choice | A `<select>` on each **membership** line only, accessible name "Level for {name}", options: empty "Level…", then Individual, Family, Supporter, Student. Nothing preselected on a new line |
| Reloaded line | The select shows the stored level |
| Save — guard | Before any request: a membership line with an amount and no level → no request is made; the line's select has `aria-invalid="true"`; message "Choose a level for {name}'s membership. Nothing was saved." (several: "Choose a level for each membership: {names}. Nothing was saved.") Choosing a level clears the mark |
| Save — sent line | A membership line carries `membershipLevel`; other lines carry none |
| Save — sales refused | "Nothing was saved: {reason}"; the PATCH is not sent |
| Save — money refused | "Sales saved, but the money figures were not: {reason}", plus "Membership recorded: …" when any |
| Save — 403 | Today's message, unchanged |
| Save — unreachable | The step's refused message, reason "Could not reach the server" |
| Save — success | Unchanged: "Saved" or "Saved. Membership recorded: {name} (through {date})" |
