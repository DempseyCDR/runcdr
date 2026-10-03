import type { ReactNode } from "react";
import styles from "./AdminPage.module.css";

// Feature 060 (X-R1): the mobile-first admin page shell. Replaces the ad-hoc `<main style={{ padding,
// maxWidth }}>` scaffolds with a single token-driven container carrying the page's one <h1> landmark —
// the admin counterpart to the public `Container`.
/**
 * Feature 087 (FR-033): `wide` lifts the 720px reading width for pages whose job is a table (the hub has
 * seven columns). Feature 087's other variant, `identity` — a per-page Volunteer marker — was retired by
 * feature 090: the volunteer bar now carries the Volunteer colour on every volunteer page.
 */
export default function AdminPage({
  title,
  children,
  wide = false,
  head,
  pinned = false,
  headBeside = false,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** Feature 091: controls that belong with the title — shown in one header with it. */
  head?: ReactNode;
  /**
   * Feature 091 (Booking Central, which opens scrolled down the page): the header — title and `head` —
   * stays pinned under the volunteer bar, its title smaller so the pinned block stays short. The page
   * sets `--volunteer-bar-height` to the bar's height.
   */
  pinned?: boolean;
  /** Feature 091: `head` on the title's own line, at its far end — for a header that must stay short. */
  headBeside?: boolean;
}) {
  const className = [styles.page, wide && styles.wide].filter(Boolean).join(" ");
  const headerClass = [pinned && styles.pinnedHead, headBeside && styles.headBeside]
    .filter(Boolean)
    .join(" ");
  const titleHeading = <h1 className={pinned ? styles.pinnedTitle : styles.title}>{title}</h1>;
  return (
    <main className={className}>
      {head || pinned ? (
        <header className={headerClass || undefined}>
          {titleHeading}
          {head}
        </header>
      ) : (
        titleHeading
      )}
      {children}
    </main>
  );
}
