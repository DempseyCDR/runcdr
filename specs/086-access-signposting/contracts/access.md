# Contract: what changes about who is offered what

**Feature**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md)

## Capabilities

| Aspect | Contract |
|---|---|
| `booker` gains | `contact.write`, global — so `POST /api/contacts` and `PATCH /api/contacts/{id}` succeed for a Booker |
| `booker` does NOT gain | `contact.delete`. `DELETE /api/contacts/{id}` still refuses a Booker |
| Every other role | **Unchanged.** A test compares the whole map, so an accidental widening fails rather than ships |

## The gate report — a capability of its own

`treasurer_report.read` is new. Held **club-wide** by `financial_secretary`, `treasurer`,
`president`, `vice_president`, `super_user` and `booker`; held by no one else. It is deliberately
**not** confined by series.

| Aspect | Contract |
|---|---|
| `GET /api/events/{id}/treasurer-report` requires | `treasurer_report.read` — narrowed from `base` |
| A Door Attendant requesting it | **Refused** |
| A Booker requesting it | Answered — reading the evening's money, never recording it |
| A Financial Secretary requesting ANY series' evening | Answered — she covers for the other Financial Secretary |
| The report's contents | **Unchanged.** This decides who may open it, nothing about what it says |
| `treasurer_report.write` | Untouched. The write capability does not imply the read one, so the Treasurer is granted both explicitly |

## `GET /api/me/capabilities` — the viewer's own series

| Aspect | Contract |
|---|---|
| Requires | `base`, unchanged |
| Answers with | today's booleans, **plus** the series the viewer holds a role for |
| A volunteer with a club-wide grant | reported as unnarrowed — the caller must not narrow anything |
| A volunteer with grants for two series | both reported |
| What it is for | deciding what a list **starts** at. It grants nothing, and the routes still decide every request |

## The shared event selector

| Aspect | Contract |
|---|---|
| On the gate report, gate money and payments | the series filter **starts** at the viewer's series |
| On check-in | **unchanged** — starts at "any series", as today |
| Changing the filter | one step, and every evening remains openable — the default is never a gate |
| A club-wide holder | no narrowing; the list starts exactly as it does today |

## The volunteer menu

| Aspect | Contract |
|---|---|
| `/treasurer` appears for | holders of `treasurer_report.read` |
| A Door Attendant | Still offered neither `/treasurer` nor `/gate` nor `/access`. The existing assertion of this stays exactly as it is |
| A Financial Secretary | Now offered `/treasurer` — the half nothing asserted before |
| Nav completeness | Unchanged — the entry still exists, so the orphan and dead-entry guards are unaffected |

## `GET /api/access/volunteers` — each grant says what it covers

| Aspect | Contract |
|---|---|
| Requires | `role.assign`, unchanged |
| Each grant answers with | `id`, `role`, `seriesId`, `groupId` — **plus `seriesKey` and `seriesName`** |
| A club-wide grant | `seriesId`, `seriesKey` and `seriesName` all null — and is described as club-wide, not as a series with no name |
| A group-scoped grant | `groupId` set, the series fields null — unchanged behaviour, distinctly labelled |
| Two grants of one role at two series | Both returned, each naming its own series |

## `/access` — the screen

| Element | Contract |
|---|---|
| A volunteer's roles | Each role is shown **with the series it covers, by name**. Never the bare words "series-scoped" |
| A club-wide role | Shown as covering every series, and not confused with a series-scoped one |
| Granting scope | Chosen from the club's actual series (fetched from `GET /api/series`), not typed from memory. "Club-wide" remains a choice |
| Granting a second series | Leaves existing grants intact; both are then listed |

## `/contacts` — a contact named in the address

| Aspect | Contract |
|---|---|
| Arriving with a contact named | That contact's record opens, the same one a list row opens |
| Arriving with an ARCHIVED contact named | It opens, and the record shows that it is archived |
| Arriving with a contact that cannot be found | The directory says so plainly, and still works normally — never the silent unfiltered list |
| Arriving with nothing named | Unchanged: the directory as it is today |

## `/manage/performers` — the link to a contact

| Element | Contract |
|---|---|
| The contact link | Opens in a new tab, naming the contact to open |
| The performer form | Still mounted, with its unsaved edits, after the link is followed |

## What a test may rely on

- A Booker can create and correct a contact, and still cannot delete one.
- The capability map differs from today's in **exactly one entry**.
- A Door Attendant is **refused** the report itself, and is offered none of `/treasurer`, `/gate`,
  `/access`.
- A Financial Secretary is answered for **every** series, including one she does not normally
  report.
- A volunteer whose roles name one series sees the list start there on the three named pages, and
  can widen it and open another series' evening without refusal.
- Check-in's list starts exactly as it does today.
- A volunteer holding one role at two series is reported with both, each naming its series.
- Opening the directory with a contact named opens that record; with an archived one, it opens and
  says so; with an unknown one, it says so.
