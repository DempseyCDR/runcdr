import type { ReactNode } from "react";
import styles from "./AdminPage.module.css";

// Feature 060 (X-R1): the mobile-first admin page shell. Replaces the ad-hoc `<main style={{ padding,
// maxWidth }}>` scaffolds with a single token-driven container carrying the page's one <h1> landmark —
// the admin counterpart to the public `Container`.
/**
 * Feature 087 (FR-032, FR-033): two opt-in variants, so no existing admin page changes by accident.
 *
 * - `identity` marks the page visibly as an ADMINISTRATIVE page rather than public content — derived from
 *   the public site's own tokens, and defined here, once, so other admin pages can adopt it by passing the
 *   prop. Booking Central is its first user; rolling it out is later work, not a precondition.
 * - `wide` lifts the 720px reading width for pages whose job is a table (the hub has seven columns).
 */
export default function AdminPage({
  title,
  children,
  identity = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  identity?: boolean;
  wide?: boolean;
}) {
  const className = [styles.page, identity && styles.identity, wide && styles.wide]
    .filter(Boolean)
    .join(" ");
  return (
    <main className={className}>
      <h1 className={styles.title}>{title}</h1>
      {children}
    </main>
  );
}
