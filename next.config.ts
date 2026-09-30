import type { NextConfig } from "next";

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
      {
        source: "/minds",
        destination: "/room",
        permanent: true,
      },
      {
        source: "/minds/:path*",
        destination: "/room/:path*",
        permanent: true,
      },
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

export default nextConfig;
