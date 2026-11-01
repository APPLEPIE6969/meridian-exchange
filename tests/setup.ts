// Global vitest setup — runs once per fork (singleFork, isolate: false).
//
// Creates a fully isolated environment for the engine singleton:
//   - a temp working directory, so engine snapshot persistence (db/market-state.json)
//     never touches (or reads) developer state
//   - a temp SQLite database via DATABASE_URL
//   - a quiet PrismaClient stashed on globalThis BEFORE '@/lib/db' is first
//     imported, so query logging stays off in test output
//   - a booted engine with the 1s wall-clock timer stopped, so every test
//     drives the engine deterministically via explicit tickInner() calls

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mrx-unit-'))
fs.mkdirSync(path.join(tmp, 'db'), { recursive: true })
process.chdir(tmp)
process.env.DATABASE_URL = `file:${tmp}/unit.db`
process.env.MRX_SESSION_SECRET = 'unit-test-secret'
delete process.env.MRX_OPERATOR_KEY // exercise the documented default

// Quiet Prisma client — db.ts prefers a pre-existing globalThis.prisma.
const { PrismaClient } = await import('@prisma/client')
;(globalThis as unknown as { prisma: unknown }).prisma = new PrismaClient({ log: ['error'] })

// Create the schema in the temp database.
execSync(`npx prisma db push --accept-data-loss --skip-generate --schema ${path.join(projectRoot, 'prisma', 'schema.prisma')}`, {
  stdio: 'pipe',
  env: { ...process.env } as NodeJS.ProcessEnv,
  cwd: projectRoot,
})

// Boot the engine singleton once for the whole run.
const { getEngineReady } = await import('@/lib/engine')
const engine = await getEngineReady()

// Stop the wall-clock tick loop: tests call engine tick paths explicitly.
type TestTimer = ReturnType<typeof setInterval>
clearInterval((engine as unknown as { timer: TestTimer | null }).timer ?? undefined)
;(engine as unknown as { timer: TestTimer | null }).timer = null

export {}
