"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import ActionBar from "./ActionBar";
import { openDialog } from "./dialogStack";
import styles from "./Dialog.module.css";

/**
 * Feature 089 (contracts/dialog.md): the one dialog on the volunteer pages.
 *
 * Its history: feature 081 built it for payments, 082 moved it here for the gate, 087 moved the Booker's
 * editors into it — and until 089 three other shells did the same job a little differently each. Now there
 * is only this one:
 *
 * - it fills a phone's screen, and sits centred from 40rem up (FR-007);
 * - its heading is its accessible name (FR-008);
 * - focus starts in its search box, else its first field (FR-010), stays inside it (FR-011), and goes back
 *   to whatever opened it (FR-012) — the dialog beneath, when one was opened over another (FR-013);
 * - Close, Escape and the phone's Back close it (FR-008, FR-008b); a tap outside does too, but only when it
 *   has no actions of its own (FR-008a);
 * - once anything in it has been typed or changed — a search box does not count — closing it asks
 *   "Discard your changes?" first (FR-012a). A dialog that stays open after a save calls
 *   `useDialogSaved()`, so its next Close does not ask;
 * - its actions sit in one bar pinned at its foot, Close first and the main action last (FR-014, FR-015).
 *   The owner passes them as `actions`; a component inside the body that owns its own buttons (a form
 *   shared by several dialogs) wraps them in `<DialogActions>` instead, and they appear in the bar.
 */

const SavedContext = createContext<() => void>(() => {});

/** Call the returned function after a save that leaves the dialog open: nothing is unsaved any more. */
export function useDialogSaved(): () => void {
  return useContext(SavedContext);
}

type Slot = {
  main: HTMLElement | null;
  secondary: HTMLElement | null;
  register: () => () => void;
};
const SlotContext = createContext<Slot | null>(null);

/** Whether this component is inside a dialog — a shared form drops its own Cancel there (the bar has Close). */
export function useInDialog(): boolean {
  return useContext(SlotContext) !== null;
}

/**
 * Buttons that belong in the dialog's action bar but are owned by a component inside its body. Inside a
 * dialog they render in the bar, after the owner's `actions`; outside one they render where they stand.
 * `secondary` ones (Archive, Restore) sit before the main ones (Save), whatever order they appear in.
 */
export function DialogActions({
  secondary = false,
  children,
}: {
  secondary?: boolean;
  children: ReactNode;
}) {
  const ctx = useContext(SlotContext);
  const register = ctx?.register;
  useEffect(() => register?.(), [register]);
  if (!ctx) return <>{children}</>;
  const slot = secondary ? ctx.secondary : ctx.main;
  return slot ? createPortal(children, slot) : null;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** `actions` that render nothing — absent, or `canWrite && …` with `canWrite` false — are no actions. */
function present(actions: ReactNode): boolean {
  return actions !== undefined && actions !== null && actions !== false;
}

export default function Dialog({
  heading,
  onClose,
  actions,
  message,
  settled = false,
  children,
}: {
  heading: string;
  onClose: () => void;
  actions?: ReactNode;
  /** Shown just above the action bar — why a Save was refused belongs beside Save, always in view. */
  message?: ReactNode;
  /** The dialog's business is done (the person turned out to be checked in already): closing loses nothing. */
  settled?: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const changed = useRef(false);
  const askingNow = useRef(false);
  const beforeAsking = useRef<HTMLElement | null>(null);
  const handle = useRef<ReturnType<typeof openDialog> | null>(null);
  const latestOnClose = useRef(onClose);
  const latestSettled = useRef(settled);
  const [asking, setAsking] = useState(false);
  // What had focus when the dialog opened — read on the first render, before a field inside it can take
  // focus for itself (the sale dialog's first field does), so Close can hand focus back to it (FR-012).
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [mainSlot, setMainSlot] = useState<HTMLElement | null>(null);
  const [secondarySlot, setSecondarySlot] = useState<HTMLElement | null>(null);
  const [bodyActions, setBodyActions] = useState(0);
  const register = useCallback(() => {
    setBodyActions((n) => n + 1);
    return () => setBodyActions((n) => n - 1);
  }, []);
  const slotContext = useMemo(
    () => ({ main: mainSlot, secondary: secondarySlot, register }),
    [mainSlot, secondarySlot, register],
  );

  useEffect(() => {
    latestOnClose.current = onClose;
    latestSettled.current = settled;
  });

  const ask = useCallback((on: boolean) => {
    askingNow.current = on;
    setAsking(on);
  }, []);

  /** Close, Escape, Back and a tap outside all come here: close at once, or ask first. */
  const requestClose = useCallback(() => {
    if (askingNow.current) return;
    if (!changed.current || latestSettled.current) return latestOnClose.current();
    beforeAsking.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ask(true);
  }, [ask]);

  const keep = useCallback(() => {
    ask(false);
    handle.current?.repush(); // Back had taken the entry away; the dialog is staying, so put it back
    beforeAsking.current?.focus();
  }, [ask]);

  const saved = useCallback(() => {
    changed.current = false;
  }, []);

  // Open: join the stack, put the cursor where typing starts, and answer Escape and Tab while on top.
  useEffect(() => {
    const h = openDialog(requestClose);
    handle.current = h;

    const own = (el: Element) => el.closest('[role="dialog"]') === panel.current;
    const b = body.current;
    const first =
      b?.querySelector<HTMLElement>('input[type="search"]') ??
      [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].find(own);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (!h.isTop()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (askingNow.current) keep();
        else requestClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(own);
      const firstItem = items[0];
      const lastItem = items.at(-1);
      if (!firstItem || !lastItem) return;
      const at = document.activeElement;
      const inside = at instanceof Node && panel.current.contains(at);
      if (e.shiftKey && (at === firstItem || !inside)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (at === lastItem || !inside)) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      h.close();
      // Back to the opener — unless whoever closed the dialog already put focus somewhere on purpose
      // (payments' "Change the number" puts it in the number field).
      const now = document.activeElement;
      const unclaimed = now === null || now === document.body || !now.isConnected;
      if (opener?.isConnected && unclaimed) opener.focus();
    };
  }, [requestClose, keep, opener]);

  // Anything typed or changed in the body — except a search, and except in a dialog opened over this one.
  useEffect(() => {
    const b = body.current;
    if (!b) return;
    const mark = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element) || t.closest('[role="dialog"]') !== panel.current) return;
      if (t instanceof HTMLInputElement && t.type === "search") return;
      changed.current = true;
    };
    b.addEventListener("input", mark);
    b.addEventListener("change", mark);
    return () => {
      b.removeEventListener("input", mark);
      b.removeEventListener("change", mark);
    };
  }, []);

  useEffect(() => {
    if (asking) keepEditing.current?.focus();
  }, [asking]);

  const hasActions = present(actions) || bodyActions > 0;
  const dialog = (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget && !hasActions) requestClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={styles.panel}
      >
        <h2 id={headingId} className={styles.heading}>
          {heading}
        </h2>
        <div ref={body} className={styles.body}>
          <SavedContext.Provider value={saved}>
            <SlotContext.Provider value={slotContext}>{children}</SlotContext.Provider>
          </SavedContext.Provider>
        </div>
        <div className={styles.foot}>
          {present(message) && <div className={styles.message}>{message}</div>}
          {asking ? (
            <ActionBar lead={<span className={styles.question}>Discard your changes?</span>}>
              <button type="button" ref={keepEditing} onClick={keep}>
                Keep editing
              </button>
              <button type="button" onClick={() => latestOnClose.current()}>
                Discard
              </button>
            </ActionBar>
          ) : (
            <ActionBar
              lead={
                <button type="button" onClick={requestClose}>
                  Close
                </button>
              }
            >
              {present(actions) ? actions : null}
              <div ref={setSecondarySlot} className={styles.slot} />
              <div ref={setMainSlot} className={styles.slot} />
            </ActionBar>
          )}
        </div>
      </div>
    </div>
  );

  // Rendered at the end of <body>, so a dialog opened from inside a table row or another dialog is never
  // clipped or stacked beneath what opened it.
  return typeof document === "undefined" ? null : createPortal(dialog, document.body);
}
