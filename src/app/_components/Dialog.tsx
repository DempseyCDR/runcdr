"use client";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Dialog.module.css";

/**
 * Feature 081: the shell every payments dialog uses — a labelled modal panel over a backdrop that scrolls
 * within a phone's viewport, closed with Escape. Focus moves into the panel when it opens.
 *
 * Feature 082: moved here from `/payments` once the gate's counting dialog and the shared sale-or-check
 * dialog needed it too.
 *
 * Feature 087: the Booker's event and booking editors moved into it too — they had opened inline at the
 * foot of Booking Central. `heading` lets a dialog keep a short accessible name ("Booking") while showing
 * a fuller title ("Booking — Ann Fiddle"); it defaults to the label.
 */
export default function Dialog({
  label,
  heading,
  onClose,
  children,
}: {
  label: string;
  heading?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A dialog that opens on a search puts the cursor there (087 walk-through); otherwise the first field.
    const el = panel.current;
    (
      el?.querySelector<HTMLElement>('input[type="search"]') ??
      el?.querySelector<HTMLElement>("input, select, textarea, button")
    )?.focus();
  }, []);
  return (
    <div className={styles.backdrop}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={styles.panel}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className={styles.heading}>{heading ?? label}</h2>
        {children}
      </div>
    </div>
  );
}
