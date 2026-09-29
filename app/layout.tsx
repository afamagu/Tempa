import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Geist, Newsreader } from "next/font/google";
import "./globals.css";
import { writingStyleFontFaceVars, writingStyleFontVariables } from "./writing-style-fonts";
import { BRAND_BACKGROUND, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

// Interface machinery — navigation, buttons, labels, metadata.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Human voice — Questions, published answers, letters, pseudonyms,
// the Tempa wordmark.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

// Public presence defaults. Icons (favicon.ico, icon.png, apple-icon.png),
// the web manifest (manifest.ts) and the default share image
// (opengraph-image.tsx) come from the App Router file conventions.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  appleWebApp: {
    title: SITE_NAME,
  },
};

export const viewport: Viewport = {
  themeColor: BRAND_BACKGROUND,
};

// Pre-beta security F-02 — every page renders per request so Next.js can
// attach the Content-Security-Policy nonce generated in proxy.ts to its
// scripts (nonces cannot exist in prerendered HTML).
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${newsreader.variable} ${writingStyleFontVariables} h-full antialiased`}
      style={writingStyleFontFaceVars}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
