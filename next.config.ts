import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Permanent compatibility redirects. Product language can evolve without
  // breaking old bookmarks, saved links or links in already-sent email.
  async redirects() {
    return [
      {
        source: "/admin/reports",
        destination: "/admin/moderation/reports",
        permanent: true,
      },
      {
        source: "/admin/reports/:id",
        destination: "/admin/moderation/reports/:id",
        permanent: true,
      },
      // Historical discovery URLs — preserve query filters and reader links.
      { source: "/letters/discover", destination: "/board/people", permanent: true },
      { source: "/minds", destination: "/board/people", permanent: true },
      { source: "/minds/:userId/dispatches", destination: "/board/people/:userId/letters", permanent: true },
      { source: "/minds/:userId", destination: "/board/people/:userId", permanent: true },
      // The previous Room and its shared-letter URLs remain useful.
      { source: "/room/letters/:id/edit", destination: "/board/letters/:id/edit", permanent: true },
      { source: "/room/letters/:id", destination: "/board/letters/:id", permanent: true },
      { source: "/room/write", destination: "/board/write", permanent: true },
      { source: "/room/questions", destination: "/board/questions", permanent: true },
      { source: "/room/:userId/dispatches", destination: "/board/people/:userId/letters", permanent: true },
      { source: "/room/:userId", destination: "/board/people/:userId", permanent: true },
      { source: "/room", destination: "/board", permanent: true },
    ];
  },
  // Safety 2 — Checkpoint 9 launch hardening. The Content-Security-
  // Policy is NOT set here: it needs a per-request nonce, so proxy.ts
  // attaches it (pre-beta security F-02, lib/security/csp.ts).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

// Tempa interface language (next-intl) WITHOUT locale routing: the plugin
// only points next-intl at i18n/request.ts. It adds no redirects, rewrites,
// headers or locale path prefixes — nextConfig above is passed through as is.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
