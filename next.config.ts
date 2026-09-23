import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Admin Command Center Phase 2A-1 — Reports moved under the new
  // Moderation nav grouping (app/admin/moderation/reports). Permanent
  // redirects so an old bookmark, a saved link, or anything still
  // pointing at the pre-2A-1 path (e.g. Overview's own "Review
  // reports" quick action, updated separately — this is belt-and-
  // suspenders for anything NOT updated) keeps working rather than
  // 404ing.
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
    ];
  },
  // Safety 2 — Checkpoint 9 launch hardening. Deliberately NOT a
  // Content-Security-Policy: a safe CSP here would need a nonce
  // architecture threaded through every server-rendered page, and would
  // otherwise risk breaking Supabase/Storage, Google OAuth, Cloudflare
  // Turnstile, and external font/image origins without dedicated
  // testing — tracked as backlog rather than destabilizing launch.
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

export default nextConfig;
