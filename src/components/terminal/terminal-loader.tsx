'use client'

import dynamic from 'next/dynamic'

// The terminal is a fully real-time, client-only application: websocket tick
// streams, wall clocks, localStorage-bound API keys and locale-dependent
// time formatting. Server-rendering it provides no value and previously
// produced SSR/client hydration mismatches (e.g. Radix Select generates its
// aria-controls id via useId, which diverged between server and client
// trees). Mounting the tree exclusively in the browser makes every
// client-generated id self-consistent by construction.
const Terminal = dynamic(() => import('@/components/terminal/terminal'), {
  ssr: false,
  loading: () => (
    <main className="flex h-screen flex-col overflow-hidden bg-[#0b0e13] text-neutral-200">
      {/* top bar skeleton */}
      <div className="h-14 shrink-0 border-b border-[#1e2530] bg-[#0b0e13]">
        <div className="flex h-full items-center gap-4 px-3">
          <div className="size-8 animate-pulse rounded bg-[#1e2530]" />
          <div className="space-y-1.5">
            <div className="h-3 w-40 animate-pulse rounded bg-[#1e2530]" />
            <div className="h-2 w-56 animate-pulse rounded bg-[#161b24]" />
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* watchlist skeleton */}
        <div className="hidden w-56 shrink-0 border-r border-[#1e2530] bg-[#0d1117] md:block lg:w-60" />
        {/* center */}
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="size-8 animate-spin rounded-full border-2 border-[#f5a524] border-t-transparent" />
            <div className="text-[11px] font-medium uppercase tracking-widest text-neutral-600">
              Connecting to Meridian Exchange…
            </div>
          </div>
        </div>
        {/* ticket skeleton */}
        <div className="hidden w-64 shrink-0 border-l border-[#1e2530] bg-[#0d1117] lg:block xl:w-72" />
      </div>
    </main>
  ),
})

export default function TerminalLoader() {
  return <Terminal />
}
