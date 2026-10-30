'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiClientError, getStoredApiKey } from '@/lib/client/api'
import { useTerminal, type AccountView } from '@/lib/client/store'
import { fmtNum } from '@/lib/client/format'
import { toast } from 'sonner'

// ─── Auth modal ──────────────────────────────────────────────────────────────

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const setAccount = useTerminal((s) => s.setAccount)
  const refresh = useAuthRefresh()

  useEffect(() => {
    const handler = () => setMode('register')
    window.addEventListener('mrx:open-auth', handler)
    return () => window.removeEventListener('mrx:open-auth', handler)
  }, [])

  const submit = async () => {
    setBusy(true)
    try {
      if (mode === 'register') {
        const res = await api.post<{ api_key: string; handle: string }>('/api/v1/auth/register', { email, password, name, handle })
        window.localStorage.setItem('mrx_api_key', res.api_key)
        toast.success(`Account approved. Welcome, ${res.handle}. $100,000 buying power is active.`)
      } else {
        const res = await api.post<{ api_key: string }>('/api/v1/auth/login', { email, password })
        window.localStorage.setItem('mrx_api_key', res.api_key)
        toast.success('Signed in.')
      }
      await refresh()
      onClose()
    } catch (e) {
      if (e instanceof ApiClientError) toast.error(e.message)
      else toast.error('Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-[#1e2530] bg-[#12161d] text-neutral-200 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-neutral-50">{mode === 'register' ? 'Open Your Meridian Account' : 'Sign In'}</DialogTitle>
          <DialogDescription className="text-xs text-neutral-500">
            {mode === 'register'
              ? 'Commission-free trading. New accounts receive a $100,000 instant deposit credit (promotional margin program).'
              : 'Access your Meridian Exchange account.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {mode === 'register' && (
            <>
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-neutral-500">Full name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Trader" className="mt-1 h-8 border-[#1e2530] bg-[#0b0e13] text-sm text-neutral-100" />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-neutral-500">Public handle (leaderboard)</Label>
                <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="alphahunter" className="mt-1 h-8 border-[#1e2530] bg-[#0b0e13] text-sm text-neutral-100" />
              </div>
            </>
          )}
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-neutral-500">Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" className="mt-1 h-8 border-[#1e2530] bg-[#0b0e13] text-sm text-neutral-100" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-neutral-500">Password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="min. 8 characters" className="mt-1 h-8 border-[#1e2530] bg-[#0b0e13] text-sm text-neutral-100" />
          </div>
          <button onClick={submit} disabled={busy || !email || !password} className="h-9 w-full rounded bg-[#f5a524] text-sm font-bold text-black hover:bg-[#ffb838] disabled:opacity-40">
            {busy ? 'Processing…' : mode === 'register' ? 'Open Account & Get $100,000' : 'Sign In'}
          </button>
          <div className="text-center text-[11px] text-neutral-500">
            {mode === 'register' ? (
              <>Already have an account? <button className="text-[#f5a524] hover:underline" onClick={() => setMode('login')}>Sign in</button></>
            ) : (
              <>New to Meridian? <button className="text-[#f5a524] hover:underline" onClick={() => setMode('register')}>Open an account</button></>
            )}
          </div>
          <p className="text-center text-[9px] leading-relaxed text-neutral-700">
            Market risk: trading involves substantial risk of loss. Not FDIC insured. Meridian Markets LLC, Member MRX/SIPC.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Account modal ───────────────────────────────────────────────────────────

export function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const account = useTerminal((s) => s.account)
  const [revealed, setRevealed] = useState(false)
  const [key, setKey] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)

  useEffect(() => {
    if (open) {
      setRevealed(false)
      setKey(getStoredApiKey())
    }
  }, [open])

  const rotate = async () => {
    setRotating(true)
    try {
      const res = await api.post<{ api_key: string }>('/api/v1/account/keys/rotate')
      window.localStorage.setItem('mrx_api_key', res.api_key)
      setKey(res.api_key)
      setRevealed(true)
      toast.success('API key rotated. Previous key revoked.')
    } catch {
      toast.error('Rotation failed.')
    } finally {
      setRotating(false)
    }
  }

  const signOut = async () => {
    await api.post('/api/v1/auth/logout').catch(() => undefined)
    window.localStorage.removeItem('mrx_api_key')
    window.location.reload()
  }

  if (!account) return null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-[#1e2530] bg-[#12161d] text-neutral-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-neutral-50">Account Overview</DialogTitle>
          <DialogDescription className="text-xs text-neutral-500">Margin account · 2x buying power · $0 commission</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2 rounded bg-[#0b0e13] p-3">
            <Field label="Account" value={account.account_number} />
            <Field label="Status" value={account.status} accent={account.status === 'ACTIVE' ? '#16c784' : '#ea3943'} />
            <Field label="Equity" value={`$${fmtNum(account.equity)}`} />
            <Field label="Cash" value={`$${fmtNum(account.cash)}`} />
            <Field label="Buying Power" value={`$${fmtNum(account.buying_power)}`} />
            <Field label="Long MV" value={`$${fmtNum(account.long_market_value)}`} />
            <Field label="Short MV" value={`$${fmtNum(account.short_market_value)}`} />
            <Field label="Member Since" value={new Date(account.created_at).toLocaleDateString()} />
          </div>

          <div className="rounded border border-[#1e2530] bg-[#0b0e13] p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">API Key</span>
              <div className="flex gap-2">
                <button onClick={() => setRevealed((r) => !r)} className="text-[10px] text-[#f5a524] hover:underline">{revealed ? 'Hide' : 'Reveal'}</button>
                <button onClick={rotate} disabled={rotating} className="text-[10px] text-neutral-400 hover:underline">{rotating ? 'Rotating…' : 'Rotate'}</button>
              </div>
            </div>
            <code className="block break-all rounded bg-black/40 p-2 text-[10px] text-neutral-300">
              {revealed && key ? key : 'mrx_live_••••••••••••••••••••••••••••••••'}
            </code>
            <p className="mt-1.5 text-[9px] leading-relaxed text-neutral-600">
              Use with <code className="text-neutral-500">Authorization: Bearer &lt;key&gt;</code> against <code className="text-neutral-500">/api/v1</code>. Full reference in API Docs.
            </p>
          </div>

          <button onClick={signOut} className="h-8 w-full rounded border border-[#ea3943]/40 text-xs font-semibold text-[#ea3943] hover:bg-[#ea3943]/10">
            Sign Out
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-neutral-600">{label}</div>
      <div className="text-[12px] font-semibold tabular-nums" style={{ color: accent ?? '#e5e9f0' }}>{value}</div>
    </div>
  )
}

// ─── Docs modal ──────────────────────────────────────────────────────────────

export function DocsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [md, setMd] = useState('Loading…')
  useEffect(() => {
    if (open) {
      fetch('/api/v1/docs')
        .then((r) => r.text())
        .then(setMd)
        .catch(() => setMd('Failed to load documentation.'))
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-[#1e2530] bg-[#12161d] text-neutral-200 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-neutral-50">Meridian Exchange — Trading API v1</DialogTitle>
          <DialogDescription className="text-xs text-neutral-500">REST + streaming reference. Base path: /api/v1</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded bg-[#0b0e13] p-3 text-[11px] leading-relaxed">
          <pre className="whitespace-pre-wrap font-mono text-neutral-300">{md}</pre>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// shared auth refresh hook logic
export function useAuthRefresh() {
  const setAccount = useTerminal((s) => s.setAccount)
  const setPositions = useTerminal((s) => s.setPositions)
  const setOrders = useTerminal((s) => s.setOrders)
  const setActivities = useTerminal((s) => s.setActivities)

  return async () => {
    try {
      const me = await api.get<AccountView>('/api/v1/auth/me')
      setAccount(me)
      const [pos, ords, acts] = await Promise.all([
        api.get<{ positions: never[] }>('/api/v1/positions'),
        api.get<{ orders: never[] }>('/api/v1/orders?status=all&limit=50'),
        api.get<{ activities: never[] }>('/api/v1/account/activities?limit=100'),
      ])
      setPositions(pos.positions)
      setOrders(ords.orders)
      setActivities(acts.activities)
    } catch {
      setAccount(null)
    }
  }
}
