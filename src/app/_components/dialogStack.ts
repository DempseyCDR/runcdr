/**
 * Feature 089 (research R2, R9; data-model.md): the dialogs open right now, bottom to top.
 *
 * Only the top dialog answers Escape, Tab and Back. Each open dialog pushes one browser-history entry at
 * the same address, so the phone's Back closes the dialog instead of leaving the page (FR-008b). A dialog
 * closed any other way — Close, Escape, a tap outside, or its owner unmounting it after a save — leaves an
 * entry behind; those are taken back together after the render, with ONE `history.go(-n)`, because two
 * dialogs closing in one render must not race two `history.back()` calls. If the address changed while
 * dialogs were open (a link inside one navigated away), going back would undo that navigation, so the
 * stack forgets its entries instead.
 *
 * While any dialog is open, the page behind it does not scroll (FR-009).
 */

type Entry = { id: number; onBack: () => void; inHistory: boolean };

export type DialogHandle = {
  /** Whether this dialog is the top one — the only one that answers Escape, Tab and Back. */
  isTop: () => boolean;
  /** Put this dialog's history entry back after Back was answered with "Keep editing". */
  repush: () => void;
  /** Take this dialog off the stack (when it unmounts). */
  close: () => void;
};

/** The state on a history entry this stack pushed — a marker beside Next.js's own. */
type DialogState = { runcdrDialog: number };

const entries: Entry[] = [];
let pushed = 0; // entries this stack has pushed and not yet taken back
let ignorePops = 0; // popstate events this stack caused itself
let address: string | null = null; // the page's address when the first entry was pushed
let listening = false;
let reconcileQueued = false;
let overflowBefore = "";
let nextId = 1;

function onPopState() {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const top = entries.at(-1);
  if (!top?.inHistory) return;
  // The browser has already taken the entry away; the dialog decides whether it closes.
  top.inHistory = false;
  pushed--;
  top.onBack();
}

function push(entry: Entry) {
  if (pushed === 0) address = window.location.href;
  const state: DialogState = { runcdrDialog: entry.id };
  window.history.pushState(state, "");
  entry.inHistory = true;
  pushed++;
}

function reconcile() {
  reconcileQueued = false;
  const live = entries.filter((e) => e.inHistory).length;
  const extra = pushed - live;
  if (extra <= 0) return;
  if (window.location.href !== address) {
    // The page moved on underneath the dialogs; going back would undo that. Forget the entries.
    for (const e of entries) e.inHistory = false;
    pushed = 0;
    address = null;
    return;
  }
  pushed = live;
  if (pushed === 0) address = null;
  ignorePops++;
  window.history.go(-extra);
}

function remove(entry: Entry) {
  const i = entries.indexOf(entry);
  if (i < 0) return;
  entries.splice(i, 1);
  if (entries.length === 0) document.documentElement.style.overflow = overflowBefore;
  if (entry.inHistory && !reconcileQueued) {
    reconcileQueued = true;
    queueMicrotask(reconcile);
  }
  entry.inHistory = false;
}

/** Put a dialog on top of the stack. `onBack` is how it hears the phone's Back. */
export function openDialog(onBack: () => void): DialogHandle {
  if (!listening) {
    window.addEventListener("popstate", onPopState);
    listening = true;
  }
  const entry: Entry = { id: nextId++, onBack, inHistory: false };
  if (entries.length === 0) {
    overflowBefore = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }
  entries.push(entry);
  push(entry);
  return {
    isTop: () => entries.at(-1) === entry,
    repush: () => {
      if (!entry.inHistory && entries.includes(entry)) push(entry);
    },
    close: () => remove(entry),
  };
}
