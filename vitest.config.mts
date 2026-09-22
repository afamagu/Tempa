import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': import.meta.dirname,
      // `server-only`'s default export unconditionally throws — real
      // safety comes from Next.js's build swapping in its `empty.js`
      // (via the `react-server` export condition) only for actual
      // Server Component bundles. Vitest never goes through that
      // bundler, so without this alias every server-only module would
      // throw the instant a test imports it, even indirectly. Aliasing
      // straight to the same empty.js Next.js itself uses keeps the
      // marker's real behavior (a build-time guard, not a runtime
      // check) without weakening it — it still catches an accidental
      // Client Component import at Next's own build step.
      'server-only': path.join(import.meta.dirname, 'node_modules', 'server-only', 'empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
  },
})
