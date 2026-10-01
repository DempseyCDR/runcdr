import Link from "next/link";
import PublicNav from "@/app/PublicNav";
import { safeNextPath } from "@/server/auth/redirect";
import styles from "./login.module.css";

/**
 * Volunteer sign-in (feature 015). Public — this is how one becomes authenticated.
 *
 * There is no registration step and no password: a designated volunteer's first successful Google
 * sign-in provisions their staff identity automatically (FR-012).
 *
 * Feature 090 US4 (FR-016–FR-020): the page looks like the club's — the public bar, the club's logotype
 * beside the sign-in (stacked on a phone), "Volunteer" where it said "Staff", who it is for, a reminder
 * for shared phones, a way forward for someone who cannot sign in, and Google's own button. A refused
 * sign-in is still reported generically.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const href =
    next === "/" ? "/api/auth/google" : `/api/auth/google?next=${encodeURIComponent(next)}`;

  return (
    <>
      <PublicNav />
      <div className={styles.page}>
        <div className={styles.brand}>
          <img
            src="/CDR_Logotype_4Color.svg"
            alt="Country Dancers of Rochester"
            className={styles.logotype}
            width={320}
            height={196}
          />
        </div>
        <main className={styles.signIn}>
          <h1 className={styles.title}>Volunteer sign-in</h1>

          {params.error ? (
            <p role="alert" className={styles.refused}>
              {/* Deliberately generic: naming the reason would let anyone probe club membership. */}
              We couldn&apos;t sign you in with that account. If you volunteer for CDR and think
              this is wrong, ask an officer to check your contact record.
            </p>
          ) : null}

          <p>For club volunteers. Dancers don&apos;t need to sign in.</p>
          <p>Volunteer areas require a CDR volunteer account.</p>

          {/* Google's standard light sign-in button: their "G" and their wording (branding guidelines). */}
          <a href={href} className={styles.google}>
            <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>Sign in with Google</span>
          </a>

          <p className={styles.note}>
            Use your <strong>cdrochester.org</strong> account if you have one, or the personal
            Google account whose address the club already has on file.
          </p>
          <p className={styles.note}>On a shared phone, sign out when you&apos;re done.</p>
          <p>
            <Link href="/contact-us" className={styles.help}>
              Can&apos;t sign in?
            </Link>
          </p>
        </main>
      </div>
    </>
  );
}
