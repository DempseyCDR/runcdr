"use client";
import { useSyncExternalStore } from "react";
import ActionBar from "./ActionBar";
import styles from "./PrintBar.module.css";

/**
 * Feature 090 (FR-023, research R10): the one Print for the club's printed reports — the gate report and the
 * organizer report. Moved here from the gate report, where feature 089 built it.
 *
 * Print is pinned to the bottom of the screen (a phone's own print is buried in a menu) and sits outside
 * the report, whose `[data-printable-report]` is all that prints: this component's stylesheet hides the
 * rest of the page, on landscape letter.
 *
 * Safari on the iPhone lays a printout out at the phone's width and would not print a report as landscape
 * letter, whatever the stylesheet said (feature 089). Desktop Safari, and Chrome on the iPhone, Android
 * and the desktop, all print properly — so only there is Print held back, with a note in its place. The
 * iPhone's other browsers name themselves (Chrome as CriOS); Safari does not. A PDF that prints the same
 * everywhere is backlog B67.
 */
function isIPhoneSafari(userAgent: string): boolean {
  return (
    /iPhone|iPod/.test(userAgent) &&
    /Version\/[\d.]+.*Safari/.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)
  );
}

const noSubscription = () => () => {};

/** Whether this browser can print a report — read after hydration, so the server's page always matches. */
function useCanPrint(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => !isIPhoneSafari(navigator.userAgent),
    () => true,
  );
}

export default function PrintBar() {
  const canPrint = useCanPrint();
  return canPrint ? (
    <ActionBar pinned>
      <button type="button" onClick={() => window.print()}>
        Print
      </button>
    </ActionBar>
  ) : (
    <p className={styles.note}>
      Safari on the iPhone cannot print this report properly — print it from Chrome or a computer.
    </p>
  );
}
