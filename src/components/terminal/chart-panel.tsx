'use client'

import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, type IChartApi, type UTCTimestamp, type Time } from 'lightweight-charts'
import { useTerminal } from '@/lib/client/store'
import { api } from '@/lib/client/api'
import { fmtNum, fmtPct, fmtMoney, fmtVol, trendColor } from '@/lib/client/format'
import { BY_SYMBOL_CLIENT } from '@/lib/client/securities'
import { openCompanyProfile } from '@/components/terminal/company-modal'
const INTERVALS = [
  { key: '1m', label: '1m', range: '1D' },
  { key: '5m', label: '5m', range: '5D' },
  { key: '15m', label: '15m', range: '1M' },
  { key: '1h', label: '1h', range: '3M' },
  { key: '1d', label: '1D', range: '1A' },
  { key: '1d', label: 'ALL', range: 'ALL' },
] as const

interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

export function ChartPanel() {
  const selected = useTerminal((s) => s.selected)
  const quotes = useTerminal((s) => s.quotes)
  const [tf, setTf] = useState(1) // index into INTERVALS — default 5m / 5D
  const [bars, setBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null)
  const volSeriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null)
  const barsRef = useRef<Bar[]>([])

  const q = quotes[selected]

  // create chart once
  useEffect(() => {
    if (!containerRef.current || chartRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0d1117' },
        textColor: '#8b95a7',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: '#161b24' }, horzLines: { color: '#161b24' } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3a4354', labelBackgroundColor: '#1e2530' },
        horzLine: { color: '#3a4354', labelBackgroundColor: '#1e2530' },
      },
      rightPriceScale: { borderColor: '#1e2530', scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: {
        borderColor: '#1e2530',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => {
          const d = new Date(Number(time) * 1000)
          return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })
        },
      },
      localization: {
        timeFormatter: (time: Time) => {
          const d = new Date(Number(time) * 1000)
          return d.toLocaleString('en-US', {
            timeZone: 'America/New_York', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false,
          })
        },
      },
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#16c784', downColor: '#ea3943', borderVisible: false,
      wickUpColor: '#16c784', wickDownColor: '#ea3943',
      priceLineColor: '#f5a524',
    })
    const volSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol', priceFormat: { type: 'volume' }, color: '#2a3242',
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, visible: false })
    chartRef.current = chart
    candleSeriesRef.current = candleSeries as unknown as ReturnType<IChartApi['addSeries']>
    volSeriesRef.current = volSeries as unknown as ReturnType<IChartApi['addSeries']>
    const ro = new ResizeObserver(() => chart.applyOptions({ width: containerRef.current?.clientWidth ?? 0, height: containerRef.current?.clientHeight ?? 0 }))
    ro.observe(containerRef.current)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // fetch candles
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const cfg = INTERVALS[tf]
      chartRef.current?.applyOptions({ timeScale: { timeVisible: cfg.key !== '1d' } })
      setLoading(true)
      try {
        const data = await api.get<{ bars: Bar[] }>(`/api/v1/market/candles?symbol=${selected}&interval=${cfg.key}&range=${cfg.range}&limit=${cfg.range === 'ALL' ? 20000 : 900}`)
        if (!cancelled) {
          // lightweight-charts requires strictly ascending, unique times — merge
          // any duplicate buckets defensively (live + synthetic overlap, etc.)
          const byT = new Map<number, Bar>()
          for (const b of data.bars) {
            const prev = byT.get(b.t)
            byT.set(b.t, prev ? { t: b.t, o: prev.o, h: Math.max(prev.h, b.h), l: Math.min(prev.l, b.l), c: b.c, v: prev.v + b.v } : b)
          }
          const merged = [...byT.values()].sort((a, b) => a.t - b.t)
          setBars(merged)
          barsRef.current = merged
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const id = window.setInterval(load, 30000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [selected, tf])

  // push bars into series
  useEffect(() => {
    const cs = candleSeriesRef.current
    const vs = volSeriesRef.current
    if (!cs || !vs) return
    cs.setData(
      bars.map((b) => ({ time: (b.t / 1000) as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c })),
    )
    vs.setData(bars.map((b) => ({ time: (b.t / 1000) as UTCTimestamp, value: b.v, color: b.c >= b.o ? '#123d2c' : '#3d1616' })))
    chartRef.current?.timeScale().fitContent()
  }, [bars])

  // live update last bar
  useEffect(() => {
    const cs = candleSeriesRef.current
    const vs = volSeriesRef.current
    if (!cs || !vs || !q) return
    const arr = barsRef.current
    const last = arr[arr.length - 1]
    if (!last) return
    const updated: Bar = { ...last, c: q.p, h: Math.max(last.h, q.p), l: Math.min(last.l, q.p), v: last.v }
    cs.update({ time: (updated.t / 1000) as UTCTimestamp, open: updated.o, high: updated.h, low: updated.l, close: updated.c })
    vs.update({ time: (updated.t / 1000) as UTCTimestamp, value: updated.v, color: updated.c >= updated.o ? '#123d2c' : '#3d1616' })
  }, [q?.p])

  const inst = BY_SYMBOL_CLIENT[selected]
  const secRow = useTerminal((s) => s.securities.find((r) => r.symbol === selected))
  const prev = bars.length ? bars[bars.length - 1] : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* symbol header */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-[#1e2530] px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tabular-nums text-neutral-100">{selected}</h2>
            <span className="max-w-[280px] truncate text-xs text-neutral-400">{inst?.name}</span>
            <button
              onClick={() => openCompanyProfile(selected)}
              title="Company profile"
              className="rounded border border-[#1e2530] bg-[#12161d] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#f5a524] hover:border-[#f5a52466]"
            >
              Profile
            </button>
            {q?.halted && <span className="rounded bg-[#ea3943] px-1.5 py-0.5 text-[9px] font-bold text-white">LULD HALTED</span>}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-neutral-50">{q ? q.p.toFixed(2) : '—'}</span>
            <span className={`text-sm font-semibold tabular-nums ${trendColor(q?.chg)}`}>
              {q ? `${q.chg >= 0 ? '+' : ''}${q.chg.toFixed(2)} (${fmtPct(q.chgp)})` : '—'}
            </span>
            <span className="text-[10px] text-neutral-600">Today</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-x-5 gap-y-1 text-[10px] sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="Bid" value={q ? `${q.b.toFixed(2)} × ${fmtVol(q.bs)}` : '—'} />
          <Stat label="Ask" value={q ? `${q.a.toFixed(2)} × ${fmtVol(q.as)}` : '—'} />
          <Stat label="Open" value={q ? q.o.toFixed(2) : '—'} />
          <Stat label="High" value={q ? q.h.toFixed(2) : '—'} />
          <Stat label="Low" value={q ? q.l.toFixed(2) : '—'} />
          <Stat label="Prev Close" value={q ? q.pc.toFixed(2) : '—'} />
          <Stat label="Volume" value={q ? fmtVol(q.v) : '—'} />
          <Stat label="Avg Vol" value={secRow ? fmtVol(secRow.avg_volume) : '—'} />
          <Stat label="Mkt Cap" value={inst && q ? fmtMoney(inst.shares * q.p) : '—'} />
          <Stat label="P/E" value={inst && inst.estEps > 0 && q ? (q.p / inst.estEps).toFixed(1) : '—'} />
          <Stat label="Div Yield" value={inst ? `${inst.divYield.toFixed(1)}%` : '—'} />
          <Stat label="52W Range" value={secRow ? `${secRow.week52_low.toFixed(0)}–${secRow.week52_high.toFixed(0)}` : '—'} />
        </div>
      </div>

      {/* interval buttons */}
      <div className="flex items-center gap-1 border-b border-[#1e2530] px-3 py-1.5">
        {INTERVALS.map((i, idx) => (
          <button
            key={`${i.key}-${i.range}`}
            onClick={() => setTf(idx)}
            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
              tf === idx ? 'bg-[#1e2530] text-[#f5a524]' : 'text-neutral-500 hover:text-neutral-200'
            }`}
          >
            {i.label}
          </button>
        ))}
        {prev && <span className="ml-auto text-[10px] text-neutral-600 tabular-nums">O {prev.o.toFixed(2)} · H {prev.h.toFixed(2)} · L {prev.l.toFixed(2)} · C {prev.c.toFixed(2)}</span>}
      </div>

      {/* chart */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]/60">
            <div className="size-6 animate-spin rounded-full border-2 border-[#f5a524] border-t-transparent" />
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-neutral-600">{label}</div>
      <div className="text-[11px] font-medium tabular-nums text-neutral-300">{value}</div>
    </div>
  )
}
