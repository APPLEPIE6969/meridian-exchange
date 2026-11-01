import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// The fallback PrismaClient (with query logging) only ever runs on the very
// first import in a fresh process — the test setup injects a quiet client on
// globalThis first, so this branch is environment-dependent, not logic.
export const db =
  /* v8 ignore next 4 */
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

/* v8 ignore next 2 */
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
