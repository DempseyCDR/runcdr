"use client";
import { apiFetch } from "@/app/apiFetch";

import { useEffect, useState } from "react";
import styles from "./hub.module.css";

/**
 * Feature 087 US3 (FR-017, FR-018) — one box that finds performers AND bands.
 *
 * The Booker types a name without first deciding whether it is a band or a person, so both are searched
 * and merged. Each result says which it is: there are no collisions in the club's data today, but a band
 * named after its lead is normal in this music, and a tag added after the first collision is a rename.
 *
 * A search OFFERS records, so archived ones are left out unless asked for — the rule feature 084 set
 * (reads that offer hide archived; reads that report never do).
 */

type Result = { kind: "performer" | "band"; id: string; name: string };

export default function HubSearch({
  onPerformer,
  onBand,
  onNewPerformer,
  onNewBand,
  q,
  onQ,
  withArchived = true,
}: {
  onPerformer: (performer: { id: string; name: string }) => void;
  onBand: (band: { id: string; name: string }) => void;
  /** Absent for a volunteer who may not edit performers — nothing is offered to make (FR-030b). */
  onNewPerformer?: (name: string) => void;
  onNewBand?: (name: string) => void;
  /** The typed text, held by the page so it can search for a band just saved (087 walk-through). */
  q: string;
  onQ: (q: string) => void;
  /**
   * Offer "Include archived". The hub does, to find a record retired by mistake; booking does not — a
   * search that offers something to BOOK hides the archived, as feature 084 set.
   */
  withArchived?: boolean;
}) {
  const setQ = onQ;
  const [archived, setArchived] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [truncated, setTruncated] = useState(false);
  // Whether the typed text has been answered — so "make one" is offered after a search, not during it.
  const [answered, setAnswered] = useState("");

  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setResults([]);
      setTruncated(false);
      setAnswered("");
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ q: needle });
    if (archived) params.set("archived", "1");
    void (async () => {
      const [pRes, bRes] = await Promise.all([
        apiFetch(`/api/performers?${params.toString()}`),
        apiFetch(`/api/bands?${params.toString()}`),
      ]);
      if (cancelled) return;
      const p = pRes.ok ? await pRes.json() : { items: [] };
      const b = bRes.ok ? await bRes.json() : { items: [] };
      const merged: Result[] = [
        ...(p.items ?? []).map((x: { id: string; displayName: string }) => ({
          kind: "performer" as const,
          id: x.id,
          name: x.displayName,
        })),
        ...(b.items ?? []).map((x: { id: string; name: string }) => ({
          kind: "band" as const,
          id: x.id,
          name: x.name,
        })),
      ].sort((x, y) => x.name.localeCompare(y.name));
      setResults(merged);
      setTruncated(!!p.truncated || !!b.truncated);
      setAnswered(needle);
    })();
    return () => {
      cancelled = true;
    };
  }, [q, archived]);

  return (
    <div className={styles.search}>
      <input
        type="search"
        aria-label="Find a performer or band"
        placeholder="Find a performer or band…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {withArchived && (
        <label className={styles.horizon}>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          Include archived
        </label>
      )}
      {results.length > 0 && (
        <ul aria-label="Search results" className={styles.results}>
          {results.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <button
                type="button"
                className={styles.link}
                onClick={() => (r.kind === "performer" ? onPerformer(r) : onBand(r))}
              >
                {r.name}
              </button>{" "}
              <span className={styles.kind}>{r.kind === "performer" ? "Performer" : "Band"}</span>
            </li>
          ))}
        </ul>
      )}
      {truncated && <p className={styles.horizon}>More matched — narrow the search.</p>}
      {/* The performers and bands pages made new records from a name that matched nobody (084 FR-008);
          this is where that went. Offered after every answer, not only an empty one: the Jane Smith you
          want may not be the Jane Smithers the search found. */}
      {answered && answered === q.trim() && (onNewPerformer || onNewBand) && (
        <div className={styles.choices}>
          {results.length === 0 && <span>Nothing matches “{answered}”.</span>}
          {onNewPerformer && (
            <button type="button" onClick={() => onNewPerformer(answered)}>
              New performer “{answered}”
            </button>
          )}
          {onNewBand && (
            <button type="button" onClick={() => onNewBand(answered)}>
              New band “{answered}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
