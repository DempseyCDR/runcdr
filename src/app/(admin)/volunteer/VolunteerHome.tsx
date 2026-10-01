import Link from "next/link";
import type { Menu, NavItem } from "@/server/auth/nav";
import styles from "./volunteer.module.css";

/**
 * Feature 090 US3 (FR-014, contracts/pages.md): the volunteer's own menu laid out as a page — the same
 * groups in the same order as the bar, Tonight first, each destination a tap target. A flat menu is one
 * list. It shows only what the menu offers; every destination still decides for itself who may use it.
 */
export default function VolunteerHome({ menu }: { menu: Menu }) {
  const list = (items: NavItem[], className = styles.list) => (
    <ul className={className}>
      {items.map((item) => (
        <li key={item.href}>
          <Link href={item.href} className={styles.link}>
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );

  if (menu.kind === "flat") return list(menu.items, `${styles.list} ${styles.flat}`);
  return (
    <div className={styles.groups}>
      {menu.groups.map((group) => (
        <section key={group.key} aria-label={group.label} className={styles.group}>
          <h2 className={styles.heading}>{group.label}</h2>
          {list(group.items)}
        </section>
      ))}
    </div>
  );
}
