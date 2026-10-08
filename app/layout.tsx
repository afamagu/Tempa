import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Geist, Newsreader } from "next/font/google";
import "./globals.css";
import { writingStyleFontFaceVars, writingStyleFontVariables } from "./writing-style-fonts";
import { BRAND_BACKGROUND, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import { localeDirection } from "@/i18n/config";

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
  viewportFit: "cover",
  // Standards-based keyboard behavior for browsers that support it
  // (notably modern Chromium/Android). Safari may continue to use the
  // visual viewport, so the shared writing hook remains the fallback there.
  interactiveWidget: "resizes-content",
};

// Pre-beta security F-02 — every page renders per request so Next.js can
// attach the Content-Security-Policy nonce generated in proxy.ts to its
// scripts (nonces cannot exist in prerendered HTML).
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  // Tempa interface language (i18n/request.ts): explicit tempa_locale
  // cookie, else a non-persistent Accept-Language match, else English.
  // Direction comes from the interface-locale registry. Messages reach
  // Client Components through NextIntlClientProvider (next-intl passes the
  // request's messages automatically).
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      dir={localeDirection(locale)}
      className={`${geistSans.variable} ${newsreader.variable} ${writingStyleFontVariables} h-full antialiased`}
      style={writingStyleFontFaceVars}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
