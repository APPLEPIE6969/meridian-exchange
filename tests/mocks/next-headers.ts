// In-memory replacement for 'next/headers' (aliased in vitest.config.ts).
// Route handlers call cookies() outside a real request scope in unit tests,
// so we provide a controllable cookie store.

const store: Record<string, string> = {}

export function __setCookie(name: string, value: string): void {
  store[name] = value
}

export function __clearCookies(): void {
  for (const k of Object.keys(store)) delete store[k]
}

export async function cookies() {
  return {
    get: (name: string) => (name in store ? { name, value: store[name] } : undefined),
    getAll: () => Object.entries(store).map(([name, value]) => ({ name, value })),
    has: (name: string) => name in store,
    set: (name: string, value: string) => {
      store[name] = value
    },
    delete: (name: string) => {
      delete store[name]
    },
  }
}

export async function headers() {
  return new Headers()
}
