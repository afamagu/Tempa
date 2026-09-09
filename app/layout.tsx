import type { Metadata } from "next";
import { Geist, Newsreader } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Tempa",
  description: "Tempa",
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
