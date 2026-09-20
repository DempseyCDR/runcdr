"use client";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Dialog.module.css";

/**
 * Feature 081: the shell every payments dialog uses — a labelled modal panel over a backdrop that scrolls
 * within a phone's viewport, closed with Escape. Focus moves into the panel when it opens.
 *
 * Feature 082: moved here from `/payments` once the gate's counting dialog and the shared sale-or-check
 * dialog needed it too.
 */
export default function Dialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
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
        <h2 className={styles.heading}>{label}</h2>
        {children}
      </div>
    </div>
  );
}
