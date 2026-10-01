import Nav from "@/app/Nav";

/**
 * Feature 090: the Route index is a volunteer page (Super-user only — the page checks), outside the
 * `(admin)` and `(door)` groups, so it renders the volunteer bar itself. It keeps no styling of its own
 * (YAGNI, spec Assumptions).
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      {children}
    </>
  );
}
