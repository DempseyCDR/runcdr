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
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const className = [styles.page, wide && styles.wide].filter(Boolean).join(" ");
  return (
    <main className={className}>
      <h1 className={styles.title}>{title}</h1>
      {children}
    </main>
  );
}
