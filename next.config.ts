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
};

export default nextConfig;
