import type { ReactNode } from "react";
import { Raleway, Open_Sans } from "next/font/google";
import "./globals.css";

export const metadata = {
  title: "CDR Platform",
  description: "Contacts & Membership",
  // Feature 055 (P7-R12): committed favicons for the browser tab.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
      { url: "/favicon.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
  },
};

// Feature 045 (P7-R1): brand fonts, self-hosted via next/font (no external request, CSP-safe). Exposed as
// CSS variables consumed by globals.css (--font-heading / --font-body).
const raleway = Raleway({ subsets: ["latin"], variable: "--font-raleway", display: "swap" });
const openSans = Open_Sans({ subsets: ["latin"], variable: "--font-open-sans", display: "swap" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${raleway.variable} ${openSans.variable}`}>
      {/* Feature 045: styling now comes from globals.css tokens (imported above). Feature 090: the root
          renders no bar. Each part of the site renders its own: public pages the public bar and, when a
          volunteer is signed in, the volunteer bar beneath it; volunteer pages the volunteer bar alone. */}
      <body>{children}</body>
    </html>
  );
}
