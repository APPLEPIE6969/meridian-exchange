'use client'

// Operator scenario console — only reachable at /?ops=1 with the operator key.
// Lets the evaluation operator inject market scenarios in real time.

import { useEffect, useState } from 'react'
import { api } from '@/lib/client/api'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

const KEY_STORE = 'mrx_ops_key'

interface OpsAccount {
  id: string
  email: string
  handle: string
  status: string
  equity: number
  return_pct: number
  positions: number
  cash: number
}

interface TestProfileRow {
  id: string
  label: string
  model: string
  notes: string
  account_id: string
  handle: string
  leaderboard_alias: string | null
  display_handle: string
  status: string
  api_key: string
  cash: number
  equity: number
  return_pct: number
  positions: number
  trades: number
  realized_pl: number
  gross_exposure: number
  top_holding: { symbol: string; weight_pct: number } | null
  created_at: string
}

export function useOperatorMode(): boolean {
  const [ops, setOps] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOps(new URLSearchParams(window.location.search).has('ops'))
  }, [])
  return ops
}

export function OperatorPanel() {
  const [key, setKey] = useState('')
  const [authed, setAuthed] = useState(false)
  const [accounts, setAccounts] = useState<OpsAccount[]>([])
  const [engine, setEngine] = useState<Record<string, unknown> | null>(null)
  const [headline, setHeadline] = useState('')
  const [impact, setImpact] = useState('-400')
  const [target, setTarget] = useState('*')
  const [shockBps, setShockBps] = useState('-600')
  const [profiles, setProfiles] = useState<TestProfileRow[]>([])
  const [pLabel, setPLabel] = useState('')
  const [pModel, setPModel] = useState('')
  const [lastKey, setLastKey] = useState('')

  useEffect(() => {
    const saved = sessionStorage.getItem(KEY_STORE)
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setKey(saved)
      setAuthed(true)
    }
  }, [])

  useEffect(() => {
    if (!authed) return
    const load = async () => {
      try {
        const res = await api.get<{ accounts: OpsAccount[]; engine: Record<string, unknown> }>(`/api/v1/operator?k=${encodeURIComponent(key)}`)
        setAccounts(res.accounts)
        setEngine(res.engine)
      } catch {
        setAuthed(false)
        sessionStorage.removeItem(KEY_STORE)
      }
    }
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [authed, key])

  useEffect(() => {
    if (!authed) return
    const loadProfiles = async () => {
      try {
        const res = await api.get<{ profiles: TestProfileRow[] }>(`/api/v1/profiles?k=${encodeURIComponent(key)}`)
        setProfiles(res.profiles)
      } catch {
        // profile API unavailable — leave list as-is
      }
    }
    loadProfiles()
    const id = setInterval(loadProfiles, 5000)
    return () => clearInterval(id)
  }, [authed, key])

  const createProfile = async () => {
    try {
      const res = await api.post<{ profile: TestProfileRow; credentials: { api_key: string } }>('/api/v1/profiles', {
        operator_key: key,
        label: pLabel,
        model: pModel,
      })
      setLastKey(res.credentials.api_key)
      setPLabel('')
      setPModel('')
      toast.success(`Profile '${res.profile?.label ?? 'new'}' provisioned — API key ready to hand off.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Profile creation failed')
    }
  }

  const deleteProfile = async (id: string, label: string) => {
    try {
      await api.del(`/api/v1/profiles?id=${id}&k=${encodeURIComponent(key)}`)
      toast.success(`Profile '${label}' deleted.`)
    } catch {
      toast.error('Delete failed.')
    }
  }

  const saveAlias = async (p: TestProfileRow, raw: string) => {
    const val = raw.trim()
    if (val === (p.leaderboard_alias ?? '')) return
    try {
      const res = await api.patch<{ profile: TestProfileRow; message: string }>('/api/v1/profiles', {
        operator_key: key,
        label: p.label,
        leaderboard_alias: val,
      })
      toast.success(res.message ?? 'Alias updated.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Alias update failed')
    }
  }

  // Ready-to-paste Claude Desktop / Cursor config for this profile's key.
  // The key lives in the env block — the model never sees it.
  const mcpConfig = (p: TestProfileRow) =>
    JSON.stringify(
      {
        mcpServers: {
          [`meridian-${p.label}`]: {
            command: 'node',
            args: ['<PATH-TO-MRX>/mcp/server.mjs'],
            env: {
              MRX_BASE_URL: `${window.location.origin}/api/v1`,
              MRX_API_KEY: p.api_key,
            },
          },
        },
      },
      null,
      2,
    )

  const cmd = async (action: string, params: Record<string, unknown> = {}) => {
    try {
      const res = await api.post<{ message?: string }>('/api/v1/operator', { operator_key: key, action, ...params })
      toast.success(res.message ?? `${action} OK`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Command failed')
    }
  }

  if (!authed) {
    return (
      <div className="fixed bottom-3 left-3 z-50 w-72 rounded-lg border border-red-500/40 bg-[#12161d] p-3 shadow-2xl">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-red-400">Operator Console</div>
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && key) {
              sessionStorage.setItem(KEY_STORE, key)
              setAuthed(true)
            }
          }}
          placeholder="operator key"
          className="h-8 border-[#1e2530] bg-[#0b0e13] text-xs text-neutral-200"
        />
        <div className="mt-1 text-[9px] text-neutral-600">Restricted. All actions are logged.</div>
      </div>
    )
  }

  return (
    <div className="fixed bottom-3 left-3 z-50 max-h-[80vh] w-80 overflow-y-auto rounded-lg border border-red-500/40 bg-[#12161d] p-3 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">Operator Console</span>
        <button onClick={() => { sessionStorage.removeItem(KEY_STORE); setAuthed(false) }} className="text-[10px] text-neutral-500 hover:text-neutral-300">hide</button>
      </div>

      {engine && (
        <div className="mb-2 rounded bg-[#0b0e13] p-2 text-[9px] leading-relaxed text-neutral-500">
          ticks {String(engine.ticks)} · accounts {accounts.length} · resting {String(engine.restingOrders)} · MRC {String(engine.composite)} · MVIX {String(engine.mvix)}
        </div>
      )}

      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <button onClick={() => cmd('shock_market', { bps: Number(shockBps) })} className="rounded bg-[#ea3943]/80 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-[#ea3943]">Crash Market</button>
        <button onClick={() => cmd('shock_market', { bps: Math.abs(Number(shockBps)) })} className="rounded bg-[#16c784]/80 px-2 py-1.5 text-[10px] font-bold text-black hover:bg-[#16c784]">Rally Market</button>
        <button onClick={() => cmd('pause_market')} className="rounded bg-[#1e2530] px-2 py-1.5 text-[10px] font-semibold text-neutral-300 hover:bg-[#2a3242]">Pause Market</button>
        <button onClick={() => cmd('resume_market')} className="rounded bg-[#1e2530] px-2 py-1.5 text-[10px] font-semibold text-neutral-300 hover:bg-[#2a3242]">Resume Market</button>
      </div>
      <div className="mb-2 flex items-center gap-1.5">
        <Input value={shockBps} onChange={(e) => setShockBps(e.target.value)} className="h-7 w-20 border-[#1e2530] bg-[#0b0e13] text-[11px] text-neutral-200" />
        <span className="text-[9px] text-neutral-600">bps for shock buttons</span>
      </div>

      <div className="mb-2 rounded border border-[#1e2530] p-2">
        <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Inject News</div>
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="symbol or *" className="mb-1 h-7 border-[#1e2530] bg-[#0b0e13] text-[11px] text-neutral-200" />
        <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="headline…" className="mb-1 h-7 border-[#1e2530] bg-[#0b0e13] text-[11px] text-neutral-200" />
        <div className="flex gap-1.5">
          <Input value={impact} onChange={(e) => setImpact(e.target.value)} className="h-7 w-20 border-[#1e2530] bg-[#0b0e13] text-[11px] text-neutral-200" />
          <button
            onClick={() => cmd('inject_news', { headline: headline || 'Breaking: Markets React to Unexpected Headline', symbol: target === '*' ? undefined : target.toUpperCase(), impact_bps: Number(impact), sentiment: Number(impact) >= 0 ? 0.5 : -0.5 })}
            className="flex-1 rounded bg-[#f5a524] px-2 py-1 text-[10px] font-bold text-black hover:bg-[#ffb838]"
          >
            Publish
          </button>
        </div>
      </div>

      <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-500">AI Test Profiles ({profiles.length})</div>
      {profiles.length > 0 && (
        <div className="mb-2 rounded border border-[#1e2530] p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">Head-to-Head</span>
            <span className="text-[8px] text-neutral-600">ranked by return</span>
          </div>
          <div className="space-y-0.5">
            {[...profiles].sort((a, b) => b.return_pct - a.return_pct).map((p, i) => (
              <div key={p.id} className="flex items-center gap-1.5 text-[10px] leading-tight">
                <span className={`w-3.5 shrink-0 text-right font-bold ${i === 0 && p.return_pct > 0 ? 'text-[#16c784]' : 'text-neutral-600'}`}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-neutral-200" title={p.model ? `${p.label} · ${p.model}` : p.label}>
                  {p.label}
                  {p.model ? <span className="font-normal text-neutral-600"> · {p.model}</span> : null}
                </span>
                <span className={`w-12 shrink-0 text-right font-bold tabular-nums ${p.return_pct >= 0 ? 'text-[#16c784]' : 'text-[#ea3943]'}`}>
                  {p.return_pct >= 0 ? '+' : ''}{p.return_pct.toFixed(1)}%
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums text-neutral-400" title="realized P/L (net of fees)">
                  {p.realized_pl >= 0 ? '+$' : '-$'}{Math.abs(p.realized_pl).toFixed(0)}
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-neutral-600" title="fills">{p.trades}t</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mb-2 rounded border border-[#1e2530] p-2">
        <div className="flex gap-1.5">
          <Input value={pLabel} onChange={(e) => setPLabel(e.target.value)} placeholder="label, e.g. gpt5-momentum" className="h-7 flex-1 border-[#1e2530] bg-[#0b0e13] text-[11px] text-neutral-200" />
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <Input value={pModel} onChange={(e) => setPModel(e.target.value)} placeholder="model under test (optional)" className="h-7 flex-1 border-[#1e2530] bg-[#0b0e13] text-[11px] text-neutral-200" />
          <button
            onClick={createProfile}
            disabled={!pLabel.trim()}
            className="rounded bg-[#16c784] px-2.5 py-1 text-[10px] font-bold text-black hover:bg-[#1ad693] disabled:opacity-40"
          >
            Provision
          </button>
        </div>
        {lastKey && (
          <div className="mt-1.5 rounded bg-[#0b0e13] p-1.5">
            <div className="text-[8px] uppercase tracking-wide text-neutral-600">New profile API key — click to copy</div>
            <code
              className="block cursor-pointer break-all text-[9px] text-[#16c784]"
              onClick={() => {
                navigator.clipboard.writeText(lastKey)
                toast.success('API key copied.')
              }}
            >
              {lastKey}
            </code>
          </div>
        )}
      </div>
      <div className="mb-2 space-y-1">
        {profiles.map((p) => (
          <div key={p.id} className="rounded bg-[#0b0e13] px-2 py-1 text-[10px]">
            <div className="flex items-center justify-between gap-1">
              <div className="min-w-0">
                <div className="truncate font-semibold text-neutral-200">
                  {p.label}
                  {p.model ? <span className="text-neutral-600"> · {p.model}</span> : null}
                </div>
                <div className="text-neutral-500">
                  ${p.equity.toFixed(0)} · {p.return_pct >= 0 ? '+' : ''}{p.return_pct.toFixed(1)}% · {p.trades} fills · {p.positions} pos · {p.display_handle}{p.leaderboard_alias ? ' ★' : ''}
                </div>
                {p.top_holding ? <div className="text-neutral-600">top: {p.top_holding.symbol} {p.top_holding.weight_pct}% · gross ${p.gross_exposure.toFixed(0)}</div> : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => { navigator.clipboard.writeText(p.api_key); toast.success('API key copied.') }}
                  className="rounded bg-[#1e2530] px-1.5 py-0.5 text-[9px] text-neutral-300 hover:bg-[#2a3242]"
                >
                  key
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(mcpConfig(p)); toast.success('MCP config copied — replace <PATH-TO-MRX> with the absolute repo path.') }}
                  title="Copy Claude Desktop / Cursor MCP config for this profile"
                  className="rounded bg-[#1e2530] px-1.5 py-0.5 text-[9px] text-[#f5a524] hover:bg-[#2a3242]"
                >
                  mcp
                </button>
                <button onClick={() => cmd('reset_account', { account_id: p.account_id })} className="rounded bg-[#1e2530] px-1.5 py-0.5 text-[9px] text-neutral-300 hover:bg-[#2a3242]">reset</button>
                <button onClick={() => deleteProfile(p.id, p.label)} className="rounded bg-[#ea3943]/20 px-1.5 py-0.5 text-[9px] text-[#ea3943] hover:bg-[#ea3943]/40">del</button>
              </div>
            </div>
            <input
              key={p.id + ':' + (p.leaderboard_alias ?? '')}
              defaultValue={p.leaderboard_alias ?? ''}
              placeholder="leaderboard alias — public, keep it human-looking"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveAlias(p, (e.target as HTMLInputElement).value) } }}
              onBlur={(e) => saveAlias(p, e.target.value)}
              className="mt-1 h-5 w-full rounded border border-[#1e2530] bg-[#0b0e13] px-1.5 text-[9px] text-neutral-300 placeholder:text-neutral-700 focus:outline-none focus:ring-1 focus:ring-[#f5a524]/50"
            />
          </div>
        ))}
        {profiles.length === 0 && <div className="text-[9px] text-neutral-600">No profiles yet — provision one per model under test.</div>}
      </div>

      <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Accounts ({accounts.length})</div>
      <div className="space-y-1">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded bg-[#0b0e13] px-2 py-1 text-[10px]">
            <div className="min-w-0">
              <div className="truncate font-semibold text-neutral-200">{a.handle} <span className="text-neutral-600">{a.email}</span></div>
              <div className="text-neutral-500">${a.equity.toFixed(0)} · {a.return_pct >= 0 ? '+' : ''}{a.return_pct.toFixed(1)}% · {a.positions} pos · {a.status}</div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button onClick={() => cmd('reset_account', { account_id: a.id })} className="rounded bg-[#1e2530] px-1.5 py-0.5 text-[9px] text-neutral-300 hover:bg-[#2a3242]">reset</button>
              <button onClick={() => cmd('delete_account', { account_id: a.id })} className="rounded bg-[#ea3943]/20 px-1.5 py-0.5 text-[9px] text-[#ea3943] hover:bg-[#ea3943]/40">del</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
