// ET clock, session classification, volatility/volume shapes, tick sizes.

import { describe, it, expect } from 'vitest'
import {
  etNow, sessionOf, SESSION_LABEL, sessionVolMult, sessionVolNumMult,
  tickSize, roundPx, dateShiftUtcMidnight, etDateToUtcMs,
} from '@/lib/engine/time'

describe('etNow', () => {
  it('formats a known instant into ET parts', () => {
    // 2026-01-15T17:30:00Z == 12:30 ET (EST, UTC-5)
    const et = etNow(Date.UTC(2026, 0, 15, 17, 30, 0))
    expect(et.date).toBe('2026-01-15')
    expect(et.hour).toBe(12)
    expect(et.minute).toBe(30)
    expect(et.minutes).toBe(12 * 60 + 30)
    expect(et.weekday).toBe('Thursday')
  })

  it('handles the ET day boundary (date differs from UTC date in the evening)', () => {
    // 2026-01-15T02:00:00Z == 2026-01-14 21:00 ET
    const et = etNow(Date.UTC(2026, 0, 15, 2, 0, 0))
    expect(et.date).toBe('2026-01-14')
    expect(et.hour).toBe(21)
  })

  it('respects daylight saving time', () => {
    // Summer: EDT is UTC-4 → 2026-07-15T17:30Z == 13:30 ET
    const summer = etNow(Date.UTC(2026, 6, 15, 17, 30, 0))
    expect(summer.hour).toBe(13)
    // Winter: EST is UTC-5
    const winter = etNow(Date.UTC(2026, 0, 15, 17, 30, 0))
    expect(winter.hour).toBe(12)
  })

  it('never reports hour 24, even at exact midnight', () => {
    // 2026-01-15T05:00:00Z == 00:00 ET
    const et = etNow(Date.UTC(2026, 0, 15, 5, 0, 0))
    expect(et.hour).toBe(0)
    expect(et.minutes).toBe(0)
  })

  it('defaults to the current time', () => {
    const et = etNow()
    expect(et.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(et.weekday.length).toBeGreaterThan(5)
  })
})

describe('sessionOf', () => {
  it('classifies the four ET sessions', () => {
    expect(sessionOf(0)).toBe('overnight') // midnight
    expect(sessionOf(239)).toBe('overnight')
    expect(sessionOf(240)).toBe('pre_market') // 04:00
    expect(sessionOf(569)).toBe('pre_market')
    expect(sessionOf(570)).toBe('regular') // 09:30
    expect(sessionOf(959)).toBe('regular')
    expect(sessionOf(960)).toBe('post_market') // 16:00
    expect(sessionOf(1199)).toBe('post_market')
    expect(sessionOf(1200)).toBe('overnight') // 20:00
    expect(sessionOf(1439)).toBe('overnight')
  })
})

describe('SESSION_LABEL', () => {
  it('labels every session', () => {
    expect(SESSION_LABEL.pre_market).toBe('Pre-Market')
    expect(SESSION_LABEL.regular).toBe('Regular Session')
    expect(SESSION_LABEL.post_market).toBe('Post-Market')
    expect(SESSION_LABEL.overnight).toBe('Overnight Session')
  })
})

describe('sessionVolMult', () => {
  it('regular session is more volatile than extended sessions', () => {
    const regular = sessionVolMult(600)
    const pre = sessionVolMult(300)
    const post = sessionVolMult(1000)
    const overnight = sessionVolMult(30)
    expect(regular).toBeGreaterThan(pre)
    expect(regular).toBeGreaterThan(post)
    expect(pre).toBe(0.55)
    expect(post).toBe(0.55)
    expect(overnight).toBe(0.32)
  })

  it('has the U-shape: open and close spikes exceed midday', () => {
    const open = sessionVolMult(575) // 5 min after open
    const midday = sessionVolMult(780) // 13:00
    const close = sessionVolMult(955) // 5 min before close
    expect(open).toBeGreaterThan(midday)
    expect(close).toBeGreaterThan(midday)
    expect(midday).toBeGreaterThan(0.7)
    expect(midday).toBeLessThan(0.75)
  })
})

describe('sessionVolNumMult', () => {
  it('volume accrues fastest in the regular session, slowest overnight', () => {
    expect(sessionVolNumMult(600)).toBeGreaterThan(sessionVolNumMult(300))
    expect(sessionVolNumMult(600)).toBeGreaterThan(sessionVolNumMult(1000))
    expect(sessionVolNumMult(1000)).toBeGreaterThan(sessionVolNumMult(30))
    expect(sessionVolNumMult(300)).toBe(0.12)
    expect(sessionVolNumMult(30)).toBe(0.045)
  })

  it('shows the U-shape in the regular session', () => {
    expect(sessionVolNumMult(575)).toBeGreaterThan(sessionVolNumMult(780))
    expect(sessionVolNumMult(955)).toBeGreaterThan(sessionVolNumMult(780))
  })
})

describe('tickSize / roundPx', () => {
  it('sub-dollar names tick at a tenth of a cent', () => {
    expect(tickSize(0.5)).toBe(0.001)
    expect(tickSize(0.999)).toBe(0.001)
  })

  it('dollar names tick at a cent', () => {
    expect(tickSize(1)).toBe(0.01)
    expect(tickSize(612.4)).toBe(0.01)
  })

  it('roundPx snaps to the tick grid', () => {
    expect(roundPx(100.123)).toBeCloseTo(100.12, 6)
    expect(roundPx(0.50049)).toBeCloseTo(0.5, 6)
    expect(roundPx(100.125)).toBeCloseTo(100.13, 6)
  })
})

describe('dateShiftUtcMidnight', () => {
  it('shifts across month and year boundaries', () => {
    expect(dateShiftUtcMidnight('2026-01-31', 1)).toBe('2026-02-01')
    expect(dateShiftUtcMidnight('2026-12-31', 1)).toBe('2027-01-01')
    expect(dateShiftUtcMidnight('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('shifts across the leap-day boundary', () => {
    expect(dateShiftUtcMidnight('2028-02-28', 1)).toBe('2028-02-29')
    expect(dateShiftUtcMidnight('2027-02-28', 1)).toBe('2027-03-01')
  })

  it('is stable across the US DST transitions (noon anchoring)', () => {
    // 2026 spring-forward: Mar 8; fall-back: Nov 1
    expect(dateShiftUtcMidnight('2026-03-07', 1)).toBe('2026-03-08')
    expect(dateShiftUtcMidnight('2026-11-01', -1)).toBe('2026-10-31')
  })
})

describe('etDateToUtcMs', () => {
  it('anchors an ET date to 17:00 UTC (≈ noon ET)', () => {
    expect(etDateToUtcMs('2026-01-15')).toBe(Date.UTC(2026, 0, 15, 17, 0, 0))
  })

  it('makes daysBetween exact', () => {
    const delta = (etDateToUtcMs('2026-02-01') - etDateToUtcMs('2026-01-01')) / 86400000
    expect(delta).toBe(31)
  })
})
