"use client";
import { apiFetch } from "@/app/apiFetch";

import { useCallback, useEffect, useState } from "react";
import ContactPicker from "@/app/ContactPicker";

/**
 * Access control (feature 016, US2) — the President/VP's screen (matrix row 20).
 *
 * The dormant feature-001 volunteer substrate finally gets a UI writer. Designating volunteers and
 * granting them scoped roles used to require the operator CLI; this is that job, in the product.
 *
 * The refusals here are the server's (403 from the access routes). Non-officers never see this page in
 * the nav (US5), but the routes enforce it regardless — hiding is presentation, not a control.
 */

type Grant = {
  id: string;
  role: string;
  seriesId: string | null;
  groupId: string | null;
  /** Feature 086 (FR-007): what the grant covers, so the screen can say it. */
  seriesKey: string | null;
  seriesName: string | null;
};
type SeriesRow = { id: string; key: string; name: string };
type Volunteer = {
  contactId: string;
  displayName: string;
  grants: Grant[];
  approvedAt: string | null;
  overdue: boolean;
  concentrationOfDuties: boolean;
};

const ROLES = [
  "door_attendant",
  "booker",
  "financial_secretary",
  "treasurer",
  "vice_president",
  "webmaster",
  "mailing_list_manager",
  "secretary",
  "president",
] as const;

/**
 * Feature 086 (FR-007, research R3): name the series, do not merely say there is one.
 *
 * This function returning the bare words "series-scoped" is why the club believed a volunteer could
 * hold one series: a Booker for TNC and a Booker for ECD rendered identically, so a second grant looked
 * like a duplicate. Multi-series always worked — it was invisible here.
 */
function scopeLabel(g: Grant): string {
  if (g.seriesId) return g.seriesName ?? g.seriesKey ?? "a series no longer in the club's list";
  if (g.groupId) return "group-scoped";
  return "club-wide";
}

export default function AccessPage() {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  // Designate form
  const [designateContactId, setDesignateContactId] = useState("");

  // Grant form
  const [subjectContactId, setSubjectContactId] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("booker");
  const [seriesKey, setSeriesKey] = useState("");
  const [seriesList, setSeriesList] = useState<SeriesRow[]>([]);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/access/volunteers");
    if (res.status === 403) {
      setMessage("You do not have access to role assignment (President or VP only).");
      return;
    }
    const data = await res.json();
    setVolunteers(data.volunteers ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Feature 086 (FR-008a): the club's real series, for the scope picker.
  useEffect(() => {
    void apiFetch("/api/series")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: SeriesRow[] }) => setSeriesList(d.items ?? []));
  }, []);

  // Designate a contact as a volunteer (FR-028). Provisional surface — the UI-spec process will settle
  // how this is presented (e.g. from the contact directory). Designation is a low-stakes nomination: it
  // grants only the Organizer base (read, no PII, no write), and makes the contact eligible for roles.
  async function designate(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await apiFetch("/api/access/volunteers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: designateContactId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setMessage(body?.error?.message ?? "Designate failed");
      return;
    }
    setMessage("Designated as a volunteer.");
    setDesignateContactId("");
    await load();
  }

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await apiFetch("/api/access/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectContactId,
        role,
        ...(seriesKey.trim() ? { seriesKey: seriesKey.trim() } : {}),
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // FR-005a's refusal is the useful case: show the required order (revoke first) rather than a bare
      // error, so a Treasurer-elected-President knows what to do.
      setMessage(body?.error?.message ?? "Grant failed");
      return;
    }
    // FR-029a: the warning is informational — the grant succeeded.
    setMessage(body?.warning ?? "Granted.");
    setSubjectContactId("");
    setSeriesKey("");
    await load();
  }

  async function revoke(grantId: string) {
    setMessage(null);
    const res = await apiFetch(`/api/access/grants?grantId=${encodeURIComponent(grantId)}`, {
      method: "DELETE",
    });
    if (!res.ok) return setMessage("Revoke failed");
    await load();
  }

  async function approve(contactId: string) {
    setMessage(null);
    const res = await apiFetch(`/api/access/volunteers/${contactId}/approve`, { method: "POST" });
    if (!res.ok) return setMessage("Approve failed");
    await load();
  }

  // Clear = report-then-confirm (FR-028a). Fetch the grants that WOULD be revoked, show them, and only
  // clear on explicit confirmation.
  async function clearVolunteer(v: Volunteer) {
    setMessage(null);
    const preview = await apiFetch(
      `/api/access/volunteers?contactId=${encodeURIComponent(v.contactId)}&preview=1`,
      { method: "DELETE" },
    );
    if (!preview.ok) return setMessage("Could not read grants");
    const { willRevoke } = (await preview.json()) as { willRevoke: Grant[] };
    const summary =
      willRevoke.length === 0
        ? "This volunteer holds no grants."
        : `This will revoke ${willRevoke.length} grant(s): ${willRevoke
            .map((g) => `${g.role} (${scopeLabel(g)})`)
            .join(", ")}.`;
    if (!confirm(`${summary}\n\nRemove ${v.displayName} as a volunteer? This cannot be undone.`)) {
      return;
    }
    const res = await apiFetch(
      `/api/access/volunteers?contactId=${encodeURIComponent(v.contactId)}`,
      {
        method: "DELETE",
      },
    );
    if (!res.ok) return setMessage("Clear failed");
    await load();
  }

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1>Access control</h1>
      <p>Designate volunteers and assign their roles. President or VP only.</p>
      {message && <p role="status">{message}</p>}

      <section>
        <h2>Designate a volunteer</h2>
        <form onSubmit={designate}>
          <ContactPicker onSelect={(c) => setDesignateContactId(c?.id ?? "")} />
          <button type="submit" disabled={!designateContactId}>
            Designate
          </button>
        </form>
        <p>
          <small>
            Makes the contact a volunteer — read access to club data, and eligible to be granted
            roles. A nomination, not an authority.{" "}
            <em>(Provisional form; the UI spec will refine how this is surfaced.)</em>
          </small>
        </p>
      </section>

      <section>
        <h2>Grant a role</h2>
        <form onSubmit={grant}>
          <ContactPicker
            onSelect={(c) => setSubjectContactId(c?.id ?? "")}
            placeholder="Search for the volunteer to grant"
          />
          <select value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {/* Feature 086 (FR-008a): chosen from the club's real series, never typed from memory — a
              mistyped key produced a grant that silently matched nothing. Club-wide stays explicit. */}
          <label>
            Scope{" "}
            <select
              aria-label="Scope"
              value={seriesKey}
              onChange={(e) => setSeriesKey(e.target.value)}
            >
              <option value="">club-wide (every series)</option>
              {seriesList.map((s) => (
                <option key={s.id} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!subjectContactId}>
            Grant
          </button>
        </form>
        <p>
          <small>
            Super-user is not grantable here — it is created only from the operator command line.
          </small>
        </p>
      </section>

      <section>
        <h2>Volunteers</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Grants</th>
              <th>Review</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {volunteers.map((v) => (
              <tr key={v.contactId}>
                <td>
                  {v.displayName}
                  {v.concentrationOfDuties && (
                    <span title="Holds an authority office and Financial Secretary (FR-029b)">
                      {" "}
                      ⚠️
                    </span>
                  )}
                </td>
                <td>
                  {v.grants.length === 0 && <em>base only</em>}
                  {v.grants.map((g) => (
                    <span key={g.id} style={{ display: "inline-block", marginRight: 8 }}>
                      {g.role} ({scopeLabel(g)}){" "}
                      <button type="button" onClick={() => revoke(g.id)}>
                        revoke
                      </button>
                    </span>
                  ))}
                </td>
                <td>
                  {v.overdue ? <strong>overdue</strong> : "current"}{" "}
                  <button type="button" onClick={() => approve(v.contactId)}>
                    approve
                  </button>
                </td>
                <td>
                  <button type="button" onClick={() => clearVolunteer(v)}>
                    remove volunteer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
