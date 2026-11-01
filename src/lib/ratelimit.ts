// Simple per-key sliding-window rate limiter: 200 requests / 60s.

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export interface RateResult {
  ok: boolean
  remaining: number
  resetInSec: number
  limit: number
}

export function checkRate(key: string, limit = 200, windowMs = 60000): RateResult {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: limit - 1, resetInSec: 60, limit }
  }
  b.count++
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
  }
  const ok = b.count <= limit
  return { ok, remaining: Math.max(0, limit - b.count), resetInSec: Math.ceil((b.resetAt - now) / 1000), limit }
}
