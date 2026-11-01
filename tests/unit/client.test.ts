// Client-safe helpers: formatters, API client wrapper, zustand store, re-exports.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fmtMoney, fmtNum, fmtPct, fmtSigned, fmtVol, fmtTime, fmtDateTime, agoLabel, trendColor } from '@/lib/client/format'
import { api, ApiClientError, getStoredApiKey, storeApiKey } from '@/lib/client/api'
import { useTerminal } from '@/lib/client/store'
import { BY_SYMBOL_CLIENT, INSTRUMENTS_CLIENT } from '@/lib/client/securities'
import { BY_SYMBOL, INSTRUMENTS } from '@/lib/engine/universe'

describe('fmtMoney', () => {
  it('formats dollars, thousands and negatives', () => {
    expect(fmtMoney(1234.5)).toBe('$1,234.50')
    expect(fmtMoney(-42)).toBe('-$42.00')
    expect(fmtMoney(0)).toBe('$0.00')
  })

  it('compacts to T/B/M tiers', () => {
    expect(fmtMoney(2.5e12)).toBe('$2.50T')
    expect(fmtMoney(1.2e9)).toBe('$1.20B')
    expect(fmtMoney(3.4e6)).toBe('$3.40M')
  })

  it('handles null/undefined/NaN as an em dash and custom precision', () => {
    expect(fmtMoney(null)).toBe('—')
    expect(fmtMoney(undefined)).toBe('—')
    expect(fmtMoney(Number.NaN)).toBe('—')
    expect(fmtMoney(5, 0)).toBe('$5')
  })
})

describe('fmtNum', () => {
  it('formats with separators and precision', () => {
    expect(fmtNum(48200, 0)).toBe('48,200')
    expect(fmtNum(3.14159)).toBe('3.14')
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(Number.NaN)).toBe('—')
  })
})

describe('fmtPct', () => {
  it('signs non-negative values and handles nullish', () => {
    expect(fmtPct(1.234)).toBe('+1.23%')
    expect(fmtPct(-4.5)).toBe('-4.50%')
    expect(fmtPct(0)).toBe('+0.00%')
    expect(fmtPct(null)).toBe('—')
    expect(fmtPct(undefined, 1)).toBe('—')
  })
})

describe('fmtSigned', () => {
  it('shows signed currency with magnitude', () => {
    expect(fmtSigned(1234.5)).toBe('+$1,234.50')
    expect(fmtSigned(-1234.5)).toBe('-$1,234.50')
    expect(fmtSigned(null)).toBe('—')
    expect(fmtSigned(Number.NaN)).toBe('—')
  })
})

describe('fmtVol', () => {
  it('compacts volumes', () => {
    expect(fmtVol(2_500_000_000)).toBe('2.50B')
    expect(fmtVol(3_400_000)).toBe('3.40M')
    expect(fmtVol(48_200)).toBe('48.2K')
    expect(fmtVol(999)).toBe('999')
    expect(fmtVol(1000.6)).toBe('1.0K')
  })
})

describe('fmtTime / fmtDateTime', () => {
  it('renders ET clock strings for numbers and strings', () => {
    const ts = Date.UTC(2026, 0, 15, 17, 30, 5)
    const t1 = fmtTime(ts)
    const t2 = fmtTime(new Date(ts).toISOString())
    expect(t1).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(t2).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    const dt = fmtDateTime(ts)
    expect(dt).toMatch(/Jan 15/)
  })
})

describe('agoLabel', () => {
  it('buckets elapsed time', () => {
    const now = Date.now()
    expect(agoLabel(now - 5_000)).toBe('5s ago')
    expect(agoLabel(now - 5 * 60_000)).toBe('5m ago')
    expect(agoLabel(now - 3 * 3_600_000)).toBe('3h ago')
    expect(agoLabel(now - 2 * 86_400_000)).toBe('2d ago')
    expect(agoLabel(now + 60_000)).toBe('0s ago') // future clamps to 0
    expect(agoLabel(new Date(now - 90_000).toISOString())).toBe('1m ago')
  })
})

describe('trendColor', () => {
  it('maps sign to tailwind classes', () => {
    expect(trendColor(5)).toBe('text-[#16c784]')
    expect(trendColor(-0.01)).toBe('text-[#ea3943]')
    expect(trendColor(0)).toBe('text-neutral-400')
    expect(trendColor(null)).toBe('text-neutral-400')
    expect(trendColor(undefined)).toBe('text-neutral-400')
  })
})

// ── api client ───────────────────────────────────────────────────────────────

describe('client api', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('parses JSON success responses', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ hello: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch
    const data = await api.get<{ hello: number }>('/x')
    expect(data).toEqual({ hello: 1 })
  })

  it('returns text for non-JSON content types', async () => {
    globalThis.fetch = vi.fn(async () => new Response('plain', { status: 200 })) as unknown as typeof fetch
    expect(await api.get<string>('/x')).toBe('plain')
  })

  it('throws ApiClientError with the server error code', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'NOPE', message: 'bad' } }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
    const err = await api.get('/x').catch((e: unknown) => e) as ApiClientError
    expect(err).toBeInstanceOf(ApiClientError)
    expect(err.status).toBe(422)
    expect(err.code).toBe('NOPE')
    expect(err.message).toBe('bad')
  })

  it('falls back to generic error fields when the body has no error object', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch
    const err = await api.get('/x').catch((e: unknown) => e) as ApiClientError
    expect(err.code).toBe('ERROR')
    expect(err.message).toBe('HTTP 500')
  })

  it('sends POST/PATCH/DELETE with JSON bodies and content type', async () => {
    const calls: RequestInit[] = []
    globalThis.fetch = vi.fn(async (_p: string, init?: RequestInit) => {
      calls.push(init ?? {})
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    await api.post('/a', { x: 1 })
    await api.patch('/b', { y: 2 })
    await api.del('/c')
    await api.post('/d') // empty body defaults to {}
    expect(calls[0].method).toBe('POST')
    expect((calls[0].body as string)).toBe('{"x":1}')
    expect(calls[1].method).toBe('PATCH')
    expect(calls[2].method).toBe('DELETE')
    expect((calls[3].body as string)).toBe('{}')
    for (const c of calls) {
      expect((c.headers as Record<string, string>)['Content-Type']).toBe('application/json')
      expect((c as { cache?: string }).cache).toBe('no-store')
    }
  })
})

describe('api key storage', () => {
  it('returns null outside the browser and round-trips in one', () => {
    // node: no window
    expect(getStoredApiKey()).toBeNull()

    const backing = new Map<string, string>()
    ;(globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, v),
      },
    }
    try {
      expect(getStoredApiKey()).toBeNull()
      storeApiKey('mrx_live_abc')
      expect(getStoredApiKey()).toBe('mrx_live_abc')
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window
    }
  })
})

// ── zustand terminal store ──────────────────────────────────────────────────

describe('terminal store', () => {
  const q = (s: string, p: number) => ({ s, p, b: p - 0.01, a: p + 0.01, bs: 100, as: 100, o: p, h: p, l: p, pc: p, v: 1, chg: 0, chgp: 0, halted: false, t: 1 })
  const idx = { composite: { symbol: 'MRC', name: 'x', level: 1, chg: 0, chgp: 0 }, mvix: 20, sectors: {}, ts: 1 }

  beforeEach(() => {
    useTerminal.setState({
      quotes: {}, prevPrices: {}, indices: null, securities: [], status: null, news: [],
      selected: 'QNTM', connected: false, account: null, positions: [], orders: [], activities: [], flash: {},
    })
  })

  it('setQuotes stores the frame and remembers previous prices', () => {
    useTerminal.getState().setQuotes([q('QNTM', 100), q('HELX', 50)], idx)
    const s1 = useTerminal.getState()
    expect(Object.keys(s1.quotes)).toEqual(['QNTM', 'HELX'])
    expect(s1.prevPrices.QNTM).toBe(100)
    expect(s1.indices).toBe(idx)

    useTerminal.getState().setQuotes([q('QNTM', 101)], idx)
    expect(useTerminal.getState().prevPrices.QNTM).toBe(100)
  })

  it('markFlash flags up/down moves and skips unchanged or first-seen symbols', () => {
    useTerminal.getState().setQuotes([q('QNTM', 100), q('HELX', 50)], idx)
    expect(useTerminal.getState().markFlash()).toBeUndefined()
    expect(useTerminal.getState().flash).toEqual({})

    useTerminal.getState().setQuotes([q('QNTM', 101), q('HELX', 49)], idx)
    useTerminal.getState().markFlash()
    expect(useTerminal.getState().flash).toEqual({ QNTM: 'up', HELX: 'down' })

    useTerminal.getState().setQuotes([q('QNTM', 101)], idx) // unchanged
    useTerminal.getState().markFlash()
    expect(useTerminal.getState().flash).toEqual({})
  })

  it('simple setters store their payloads', () => {
    const st = useTerminal.getState()
    st.setSecurities([{ symbol: 'QNTM' } as never])
    st.setStatus({ session: 'regular', session_label: 'Regular Session', date: '2026-01-01', time: '10:00:00', weekday: 'Thursday', open: true })
    st.setNews([{ id: 'n1' } as never])
    st.select('HELX')
    st.setConnected(true)
    st.setAccount({ id: 'a' } as never)
    st.setPositions([{ symbol: 'QNTM' }] as never)
    st.setOrders([{ id: 'o' }] as never)
    st.setActivities([{ id: 'f' }] as never)
    const s = useTerminal.getState()
    expect(s.securities[0].symbol).toBe('QNTM')
    expect(s.status?.session).toBe('regular')
    expect(s.news[0].id).toBe('n1')
    expect(s.selected).toBe('HELX')
    expect(s.connected).toBe(true)
    expect(s.account?.id).toBe('a')
    expect(s.positions).toHaveLength(1)
    expect(s.orders).toHaveLength(1)
    expect(s.activities).toHaveLength(1)
  })

  it('prependNews adds newest first and caps the wire at 120 items', () => {
    for (let i = 0; i < 130; i++) useTerminal.getState().prependNews({ id: `n${i}` } as never)
    const news = useTerminal.getState().news
    expect(news).toHaveLength(120)
    expect(news[0].id).toBe('n129')
    expect(news[119].id).toBe('n10')
  })
})

describe('client securities re-export', () => {
  it('re-exports the universe for client bundles', () => {
    expect(BY_SYMBOL_CLIENT).toBe(BY_SYMBOL)
    expect(INSTRUMENTS_CLIENT).toBe(INSTRUMENTS)
  })
})

describe('coverage edges', () => {
  it('patch without a body sends an empty JSON object', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    try {
      await api.patch('/no-body')
      const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
      expect(init.body).toBe('{}')
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it('responses without a content-type fall back to text', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    try {
      expect(await api.get('/no-ct')).toBe('')
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it('fmtDateTime accepts ISO strings', () => {
    expect(fmtDateTime('2026-01-15T17:30:00Z')).toMatch(/Jan 15/)
  })

  it('cn merges class names', async () => {
    const { cn } = await import('@/lib/utils')
    expect(cn('a', 'b')).toContain('a')
    expect(cn('a', 'b')).toContain('b')
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn()).toBe('')
  })
})
