import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Vitest is the unit/integration gate for Meridian Exchange.
//
// Coverage policy: every server-side module (src/lib/**, src/app/api/**,
// src/proxy.ts) must be covered at the thresholds declared below — the CI
// job fails if coverage drops. The browser UI (src/components, src/app
// pages, src/hooks) is exercised end-to-end by the e2e suites
// (scripts/smoke-test.mjs, api-matrix, mcp-protocol, ws-relay) against a
// real built server instead of mocked component rendering.

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      // Route handlers call cookies() from 'next/headers' outside a request
      // scope when invoked directly in tests. The alias routes that to a
      // controllable in-memory cookie store (tests/mocks/next-headers.ts).
      'next/headers': path.resolve(process.cwd(), 'tests/mocks/next-headers.ts'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
    hookTimeout: 120000,
    // The engine is a global singleton with a SQLite database; running all
    // files in one fork keeps state transitions realistic and fast.
    isolate: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/lib/**', 'src/app/api/**', 'src/proxy.ts'],
      exclude: ['**/*.d.ts', 'src/lib/generated/**'],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
})
