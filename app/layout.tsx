import type { Metadata, Viewport } from "next";
import { Geist, Newsreader } from "next/font/google";
import "./globals.css";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
