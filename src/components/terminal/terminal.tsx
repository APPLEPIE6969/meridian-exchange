'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useTerminal, type NewsItem, type Quote, type IndexState } from '@/lib/client/store'
import { api, getStoredApiKey } from '@/lib/client/api'
import { useAuthRefresh } from '@/components/terminal/modals'
import { toast } from 'sonner'
import { TopBar } from '@/components/terminal/top-bar'
import { Watchlist } from '@/components/terminal/watchlist'
import { ChartPanel } from '@/components/terminal/chart-panel'
import { OrderTicket } from '@/components/terminal/order-ticket'
import { BookPanel } from '@/components/terminal/book-panel'
import { BottomPanel } from '@/components/terminal/bottom-panel'
import { AuthModal, AccountModal, DocsModal } from '@/components/terminal/modals'
import { CompanyProfileModal } from '@/components/terminal/company-modal'
import { OperatorPanel, useOperatorMode } from '@/components/terminal/operator'

export default function Terminal() {
  const setQuotes = useTerminal((s) => s.setQuotes)
  const markFlash = useTerminal((s) => s.markFlash)
  const setSecurities = useTerminal((s) => s.setSecurities)
  const setStatus = useTerminal((s) => s.setStatus)
  const setNews = useTerminal((s) => s.setNews)
  const prependNews = useTerminal((s) => s.prependNews)
  const setConnected = useTerminal((s) => s.setConnected)
  const account = useTerminal((s) => s.account)
  const socketRef = useRef<Socket | null>(null)
  const refresh = useAuthRefresh()
  const isOps = useOperatorMode()

  const [authOpen, setAuthOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  // client-only latency readout — never computed during render (hydration-safe)
  const [latency, setLatency] = useState<number | null>(null)
  useEffect(() => {
    const update = () => setLatency(12 + (Math.floor(Date.now() / 5000) % 7))
    update()
    const id = window.setInterval(update, 5000)
    return () => window.clearInterval(id)
  }, [])

  const refreshAccountData = useCallback(async () => {
    await refresh()
  }, [refresh])

  // initial data load
  useEffect(() => {
    void (async () => {
      try {
        const [stocks, status, news, indices] = await Promise.all([
          api.get<{ securities: Parameters<typeof setSecurities>[0] }>('/api/v1/market/stocks'),
          api.get<Parameters<typeof setStatus>[0]>('/api/v1/market/status'),
          api.get<{ news: NewsItem[] }>('/api/v1/news?limit=60'),
          api.get<IndexState>('/api/v1/market/indices'),
        ])
        setSecurities(stocks.securities)
        setStatus(status)
        setNews(news.news)
        setQuotes([], indices)
      } catch {
        // server warming up; socket + polls will fill in
      }
      await refreshAccountData()
    })()

  }, [])

  // socket
  useEffect(() => {
    // Stream URL: same-origin proxy by default (hosted front-ends), or an
    // explicit relay address via NEXT_PUBLIC_MRX_STREAM_URL — e.g. a plain
    // local install sets it to http://localhost:3003 (market-relay service).
    const socket = io(process.env.NEXT_PUBLIC_MRX_STREAM_URL || '/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      const key = getStoredApiKey()
      if (key) socket.emit('subscribe-account', { api_key: key })
    })
    socket.on('disconnect', () => setConnected(false))

    let frameCount = 0
    socket.on('ticks', (data: { quotes: Quote[]; indices: IndexState }) => {
      setQuotes(data.quotes, data.indices)
      frameCount++
      if (frameCount % 3 === 0) markFlash()
    })

    socket.on('news', (item: NewsItem) => {
      prependNews(item)
      const major = Math.abs(item.impactBps) >= 250 || item.kind === 'earnings' || item.kind === 'ma' || item.kind === 'halt'
      if (major) {
        toast(item.headline, {
          description: `${item.source} · impact ${item.impactBps > 0 ? '+' : ''}${item.impactBps} bps`,
          duration: 7000,
          style: {
            background: item.sentiment >= 0 ? '#0f2a1e' : '#2a1215',
            color: '#e5e9f0',
            border: `1px solid ${item.sentiment >= 0 ? '#16c78455' : '#ea394355'}`,
          },
        })
      }
    })

    socket.on('fill', (f: { symbol?: string; qty: number; price: number; status: string }) => {
      toast.success(`Fill: ${f.qty} ${f.symbol ?? ''} @ $${f.price}`, { duration: 5000 })
      void refreshAccountData()
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }

  }, [])

  // status poll
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const status = await api.get<Parameters<typeof setStatus>[0]>('/api/v1/market/status')
        setStatus(status)
      } catch {
        // ignore
      }
    }, 10000)
    return () => clearInterval(id)
  }, [setStatus])

  // re-subscribe account events when key changes
  useEffect(() => {
    const handler = () => {
      const key = getStoredApiKey()
      if (key && socketRef.current?.connected) {
        socketRef.current.emit('subscribe-account', { api_key: key })
      }
    }
    window.addEventListener('mrx:auth-changed', handler)
    return () => window.removeEventListener('mrx:auth-changed', handler)
  }, [])

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#0b0e13] text-neutral-200">
      <TopBar onOpenAccount={() => setAccountOpen(true)} onOpenAuth={() => setAuthOpen(true)} onOpenDocs={() => setDocsOpen(true)} />

      <div className="flex min-h-0 flex-1">
        {/* left: watchlist */}
        <aside className="hidden w-56 shrink-0 md:block lg:w-60">
          <Watchlist />
        </aside>

        {/* center */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-[1.6] flex-col">
            <ChartPanel />
          </div>
          <div className="h-[38%] min-h-[220px]">
            <BottomPanel onChanged={refreshAccountData} onNeedAuth={() => setAuthOpen(true)} />
          </div>
        </section>

        {/* right: ticket + book */}
        <aside className="hidden w-64 shrink-0 flex-col border-l border-[#1e2530] bg-[#0d1117] lg:flex xl:w-72">
          <OrderTicket onChanged={refreshAccountData} />
          <BookPanel />
        </aside>
      </div>

      {/* mobile ticket shortcut */}
      <div className="border-t border-[#1e2530] bg-[#0d1117] p-2 lg:hidden">
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-neutral-500">Full order ticket available on desktop view</div>
          <button onClick={() => setAuthOpen(true)} className="rounded bg-[#f5a524] px-3 py-1 text-[11px] font-bold text-black">
            {account ? 'My Account' : 'Open Account'}
          </button>
        </div>
      </div>

      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[#1e2530] bg-[#0b0e13] px-3 text-[9px] text-neutral-600">
        <span>Meridian Markets LLC · Member MRX & SIPC · SEC-registered national securities exchange</span>
        <span className="hidden sm:inline">System status: Normal · Latency: {latency == null ? '—' : `${latency}ms`} · Data 15-min delayed for non-subscribers</span>
      </footer>

      <AuthModal open={authOpen} onClose={() => { setAuthOpen(false); void refreshAccountData(); window.dispatchEvent(new Event('mrx:auth-changed')) }} />
      <AccountModal open={accountOpen} onClose={() => setAccountOpen(false)} />
      <DocsModal open={docsOpen} onClose={() => setDocsOpen(false)} />
      <CompanyProfileModal />
      {isOps && <OperatorPanel />}
    </main>
  )
}
