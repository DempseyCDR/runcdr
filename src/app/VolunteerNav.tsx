"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Menu, MenuGroup, NavItem } from "@/server/auth/nav";
import styles from "./VolunteerNav.module.css";

/**
 * The volunteer menu — the client presenter (feature 035; rebuilt for feature 090).
 *
 * Rendered by the server component `Nav`, which decides the grouped `menu` (authorization stays on the
 * server). A client component because the current page, the open group and the keyboard need it.
 *
 * Feature 090 (contracts/menu.md):
 * - **One coloured bar** marks every volunteer page (the band colour lives here, not on each page).
 * - **Groups by the kind of work.** Tonight's links are flat and first; every other group of two or
 *   more is a disclosure — a button that opens a list of links beneath it — one open at a time. A group
 *   of one is a plain link; six or fewer destinations are a flat row (`menuFor`).
 * - **The keyboard:** Enter or Space opens a group; Down, Up, Home and End move within it; Escape closes
 *   it and returns focus to its button. A click outside, a chosen link or a new page closes it. Hover
 *   opens nothing (touch, not hover).
 * - **On a phone** (below 48rem) the bar is the volunteer's name and a Menu button, one line. The Menu
 *   lists Tonight first, then every group open under its heading, then Sign out and Club site — one
 *   list, so each destination is in the page once (the stylesheet decides which layout shows).
 * - **Without JavaScript** every group's list, and the Menu, are shown open.
 *
 * ⚠️ Presentation, not a control: it renders whatever it is given; each destination enforces its own
 * access. Feature 083 (B53): Sign out is a plain form submission — the route is POST-only because a GET
 * sign-out is CSRF-triggerable, and a real submission works with no JavaScript.
 */
export default function VolunteerNav({
  menu,
  signedInAs,
}: {
  menu: Menu;
  /** Whose session this device holds — always shown, so a shared phone says who it is. */
  signedInAs: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const focusFirstOf = useRef<string | null>(null);
  const idBase = useId();
  const panelId = (key: string) => `${idBase}-${key}`;

  const isActive = (href: string) =>
    !!pathname && (pathname === href || pathname.startsWith(href + "/"));

  // A new page closes any open group, and the Menu.
  useEffect(() => {
    setOpen(null);
    setMenuOpen(false);
  }, [pathname]);

  // A click anywhere outside the bar closes an open group.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && nav.current?.contains(e.target)) return;
      setOpen(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Down on a closed group's button opens it; once its list is on screen, focus its first link.
  useEffect(() => {
    if (!open || focusFirstOf.current !== open) return;
    focusFirstOf.current = null;
    document.getElementById(panelId(open))?.querySelector<HTMLElement>("a")?.focus();
  });

  const link = (item: NavItem) => (
    <Link
      href={item.href}
      aria-current={isActive(item.href) ? "page" : undefined}
      className={styles.link}
      onClick={() => {
        setOpen(null);
        setMenuOpen(false);
      }}
    >
      {item.label}
    </Link>
  );

  function onGroupKey(e: KeyboardEvent<HTMLDivElement>, key: string) {
    const panel = document.getElementById(panelId(key));
    const button = e.currentTarget.querySelector<HTMLButtonElement>("button");
    const links = [...(panel?.querySelectorAll<HTMLElement>("a") ?? [])];
    const at = links.findIndex((l) => l === document.activeElement);
    const go = (i: number) => links[Math.max(0, Math.min(links.length - 1, i))]?.focus();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (open !== key) {
          focusFirstOf.current = key;
          setOpen(key);
        } else go(at + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open === key) go(at - 1);
        break;
      case "Home":
        if (open !== key) return;
        e.preventDefault();
        go(0);
        break;
      case "End":
        if (open !== key) return;
        e.preventDefault();
        go(links.length - 1);
        break;
      case "Escape":
        if (open !== key) return;
        e.preventDefault();
        setOpen(null);
        button?.focus();
        break;
    }
  }

  const heading = (label: string) => <h2 className={styles.groupHeading}>{label}</h2>;

  const group = (g: MenuGroup) => {
    // Tonight and a group of one are plain links on a computer; on a phone they still sit under a heading.
    if (g.key === "tonight" || g.items.length === 1) {
      return (
        <li key={g.key} className={styles.plainGroup}>
          {heading(g.label)}
          <ul className={styles.plainItems}>
            {g.items.map((item) => (
              <li key={item.href}>{link(item)}</li>
            ))}
          </ul>
        </li>
      );
    }
    const isOpen = open === g.key;
    return (
      <li key={g.key}>
        <div className={styles.group} onKeyDown={(e) => onGroupKey(e, g.key)}>
          {heading(g.label)}
          <button
            type="button"
            className={styles.groupButton}
            aria-expanded={isOpen}
            aria-controls={panelId(g.key)}
            onClick={() => setOpen(isOpen ? null : g.key)}
          >
            {g.label}
          </button>
          <ul
            id={panelId(g.key)}
            data-group-panel=""
            className={isOpen ? `${styles.groupPanel} ${styles.open}` : styles.groupPanel}
          >
            {g.items.map((item) => (
              <li key={item.href}>{link(item)}</li>
            ))}
          </ul>
        </div>
      </li>
    );
  };

  return (
    <nav
      aria-label="Main"
      ref={nav}
      className={styles.bar}
      onKeyDown={(e) => {
        // Escape closes the Menu — unless an open group already handled it.
        if (e.key !== "Escape" || e.defaultPrevented || !menuOpen) return;
        setMenuOpen(false);
        menuButton.current?.focus();
      }}
    >
      <Link href="/volunteer" className={styles.home}>
        Volunteer
      </Link>
      {/* On a phone: whose session this is, always in view, and the Menu (FR-010, FR-011). */}
      <span className={styles.name}>{signedInAs}</span>
      <button
        ref={menuButton}
        type="button"
        className={styles.menuButton}
        aria-expanded={menuOpen}
        aria-controls={`${idBase}-menu`}
        onClick={() => setMenuOpen((o) => !o)}
      >
        Menu
      </button>
      <div
        id={`${idBase}-menu`}
        data-menu-panel=""
        className={menuOpen ? `${styles.menu} ${styles.menuOpen}` : styles.menu}
      >
        <ul className={styles.destinations}>
          {menu.kind === "flat"
            ? menu.items.map((item) => <li key={item.href}>{link(item)}</li>)
            : menu.groups.map(group)}
        </ul>
        <span className={styles.signedIn}>Signed in as {signedInAs}</span>
        <form action="/api/auth/signout" method="post">
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
        <Link href="/" className={styles.link}>
          Club site
        </Link>
      </div>
      {/* No JavaScript: every group's list is shown, so no destination is out of reach (M7). */}
      <noscript>
        <style>{`[data-menu-panel]{display:flex !important}[data-group-panel]{display:block !important;position:static !important}`}</style>
      </noscript>
    </nav>
  );
}
