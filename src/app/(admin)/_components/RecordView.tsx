import type { ReactNode } from "react";
import { DialogActions, useInDialog } from "@/app/_components/Dialog";
import styles from "./RecordView.module.css";

// Feature 060 (X-R2): Record mode — a focused single-entity view/editor shell. Presentation only: it
// renders a titled region (a landmark named by the entity), an optional actions slot, and the caller's
// fields/sections stacked vertically. It performs no data fetching, mutation, or authorization (FR-009);
// the consuming feature supplies the content.
//
// Feature 089: every Record-mode view opens in the one dialog. There the dialog's heading carries the
// title, so the view does not repeat it, and its actions join the dialog's action bar.
export default function RecordView({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const inDialog = useInDialog();
  if (inDialog) {
    return (
      <section className={styles.inDialog} aria-label={title}>
        <div className={styles.body}>{children}</div>
        {actions ? <DialogActions>{actions}</DialogActions> : null}
      </section>
    );
  }
  return (
    <section className={styles.record} aria-label={title}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
