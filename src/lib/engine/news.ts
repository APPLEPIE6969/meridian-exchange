// MRX news wire — generates believable headlines and stories whose
// sentiment produces real price impulses in the matching engine.

import { Rng, roundTo } from './rng'
import { Instrument } from './universe'

export interface GeneratedNews {
  headline: string
  body: string
  source: string
  kind:
    | 'analyst'
    | 'earnings'
    | 'guidance'
    | 'product'
    | 'regulatory'
    | 'ma'
    | 'insider'
    | 'capital'
    | 'macro'
    | 'legal'
    | 'color'
    | 'halt'
  symbols: string[] // affected symbols; '@SectorName' = sector-wide; '*' = whole market
  sentiment: number // -1 .. 1
  impactBps: number // primary-symbol impact in basis points
}

const FIRMS = [
  'Halloran & Beck', 'Northgate Research', 'Pemberton Capital Advisors', 'Sterling Ridge Securities',
  'Calloway Partners', 'Arrowfield Analytics', 'Wexler Grant', 'Beacon Point Research',
  'Crestline Advisors', 'Juniper Mesa Capital', 'Dunmore Fitzgerald', 'Sable Rock Securities',
]

const ANALYSTS = [
  'K. Ostrander', 'M. Feliciano', 'D. Whitcombe', 'S. Nakagawa', 'R. Beaupre', 'T. Alessi',
  'J. van der Merwe', 'L. Fontaine', 'C. Radziwill', 'P. Kowalczyk', 'A. Blackwood', 'N. Ferreira',
]

const RATINGS_UP = ['Strong Buy', 'Buy', 'Outperform', 'Overweight']
const RATINGS_MID = ['Hold', 'Neutral', 'Market Perform', 'Sector Perform']
const RATINGS_DOWN = ['Underperform', 'Sell', 'Underweight', 'Reduce']

const SOURCES = [
  'Meridian Wire', 'StreetPulse', 'Capital Markets Daily', 'The Macro Desk',
  'Meridian Post', 'Business Newswire', 'Quant Feed', 'MRX Newsroom', 'The Funding Ledger',
]

const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng.u() * arr.length)]

function analystAction(rng: Rng, inst: Instrument): GeneratedNews {
  const firm = pick(rng, FIRMS)
  const analyst = pick(rng, ANALYSTS)
  const roll = rng.u()
  let sentiment: number
  let headline: string
  let body: string
  const pt = roundTo(inst.basePrice * rng.range(0.82, 1.28), 0)
  if (roll < 0.34) {
    const from = pick(rng, [...RATINGS_MID, ...RATINGS_DOWN])
    const to = pick(rng, RATINGS_UP)
    sentiment = rng.range(0.45, 0.85)
    headline = `${firm} Upgrades ${inst.symbol} to ${to}, Sees Path to $${pt}`
    body = `Analyst ${analyst} raised the firm's rating on ${inst.name} (${inst.symbol}) from ${from} to ${to}, citing improving operating leverage and a stronger bookings pipeline. The firm lifted its price target to $${pt}, implying roughly ${Math.round(((pt / inst.basePrice) - 1) * 100)}% upside from current levels. "${inst.symbol} remains one of the best risk/reward setups in our coverage," the note said.`
  } else if (roll < 0.62) {
    const to = pick(rng, RATINGS_UP)
    sentiment = rng.range(0.3, 0.6)
    headline = `${firm} Initiates ${inst.symbol} at ${to}, $${pt} Target`
    body = `${firm} launched coverage of ${inst.name} (${inst.symbol}) with a ${to} rating and a $${pt} price target. In the initiation note, analyst ${analyst} pointed to durable revenue growth and expanding margins as key drivers over the next 12 to 18 months. The firm said it views current levels as an attractive entry point.`
  } else if (roll < 0.82) {
    const from = pick(rng, [...RATINGS_UP, ...RATINGS_MID])
    const to = pick(rng, RATINGS_DOWN)
    sentiment = -rng.range(0.45, 0.85)
    headline = `${firm} Downgrades ${inst.symbol} to ${to} on Valuation`
    body = `Analyst ${analyst} at ${firm} cut the rating on ${inst.name} (${inst.symbol}) from ${from} to ${to}, arguing the stock has outrun near-term fundamentals. The firm lowered its price target to $${pt} and flagged decelerating order trends as a concern heading into the next print.`
  } else {
    const rating = pick(rng, [...RATINGS_UP, ...RATINGS_MID])
    const dir = rng.u() < 0.55 ? 'Raises' : 'Lowers'
    sentiment = dir === 'Raises' ? rng.range(0.25, 0.55) : -rng.range(0.25, 0.55)
    headline = `${firm} ${dir} ${inst.symbol} Price Target to $${pt}, Keeps ${rating}`
    body = `${firm} adjusted its price target on ${inst.name} (${inst.symbol}) to $${pt} while maintaining a ${rating} rating. Analyst ${analyst} updated model assumptions following recent sector checks, describing the revision as primarily valuation-driven rather than a change in the fundamental thesis.`
  }
  return { headline, body, source: pick(rng, SOURCES), kind: 'analyst', symbols: [inst.symbol], sentiment: roundTo(sentiment, 2), impactBps: Math.round(sentiment * rng.range(80, 320)) }
}

function productNews(rng: Rng, inst: Instrument): GeneratedNews {
  const roll = rng.u()
  if (roll < 0.3) {
    const amount = Math.round(rng.range(120, 2400)) * 1e6
    const partner = pick(rng, ['a leading hyperscaler', 'a top-5 global automaker', 'the U.S. Department of Defense', 'a major European carrier', 'a Fortune 100 retailer', 'a national health system'])
    return {
      headline: `${inst.symbol} Wins ${'$' + (amount / 1e6).toFixed(0) + 'M'} Multi-Year Contract With ${partner.charAt(0).toUpperCase() + partner.slice(1)}`,
      body: `${inst.name} announced a multi-year agreement valued at approximately $${(amount / 1e6).toFixed(0)} million with ${partner}. Management said deployments begin this quarter with revenue recognized ratably over the contract term. Analysts view the win as validation of the company's pipeline and a potential catalyst for follow-on deals.`,
      source: pick(rng, SOURCES), kind: 'product', symbols: [inst.symbol], sentiment: roundTo(rng.range(0.4, 0.8), 2), impactBps: Math.round(rng.range(90, 340)),
    }
  }
  if (roll < 0.55) {
    return {
      headline: `${inst.symbol} Unveils Next-Generation Platform at Annual Developer Summit`,
      body: `${inst.name} pulled the wraps off its next-generation platform, highlighting a ${rng.range(2, 5).toFixed(1)}x improvement in throughput and new automation tooling. Early access customers reported ${rng.range(15, 40).toFixed(0)}% lower total cost of operation. The company said general availability is targeted for next quarter, with pricing unchanged for existing customers.`,
      source: pick(rng, SOURCES), kind: 'product', symbols: [inst.symbol], sentiment: roundTo(rng.range(0.3, 0.7), 2), impactBps: Math.round(rng.range(60, 260)),
    }
  }
  if (roll < 0.8) {
    const partner = pick(rng, ['NEURX', 'QNTM', 'AXNDA', 'CLDU', 'SYNTQ', 'MRDN'])
    return {
      headline: `${inst.symbol}, ${partner} Announce Strategic Partnership on Integrated Offering`,
      body: `${inst.name} and the two companies will co-develop an integrated offering combining ${inst.symbol}'s core platform with ${partner}'s distribution reach. Joint go-to-market begins next month. Terms were not disclosed, but management indicated the partnership carries "meaningful revenue contribution" within four quarters.`,
      source: pick(rng, SOURCES), kind: 'product', symbols: [inst.symbol, partner], sentiment: roundTo(rng.range(0.2, 0.6), 2), impactBps: Math.round(rng.range(50, 200)),
    }
  }
  return {
    headline: `${inst.symbol} Reports Strong Early Adoption Metrics for Flagship Product Line`,
    body: `In an investor update, ${inst.name} disclosed that activations for its flagship product line reached an all-time high last month, up ${rng.range(18, 55).toFixed(0)}% year over year. Management reiterated that demand remains ahead of supply in key segments. Shares have attracted increased attention from institutional buyers in recent weeks.`,
    source: pick(rng, SOURCES), kind: 'product', symbols: [inst.symbol], sentiment: roundTo(rng.range(0.25, 0.6), 2), impactBps: Math.round(rng.range(40, 180)),
  }
}

function guidanceNews(rng: Rng, inst: Instrument): GeneratedNews {
  const up = rng.u() < 0.52
  if (up) {
    return {
      headline: `${inst.symbol} Raises Full-Year Guidance Above Street on Strong Demand`,
      body: `${inst.name} lifted its full-year outlook, now expecting revenue growth of ${rng.range(9, 24).toFixed(1)}% and adjusted margins at the high end of prior targets. Management cited broad-based demand, pricing discipline, and favorable mix. The updated forecast came alongside preliminary quarter results that were described as "ahead of internal plan."`,
      source: pick(rng, SOURCES), kind: 'guidance', symbols: [inst.symbol], sentiment: roundTo(rng.range(0.5, 0.9), 2), impactBps: Math.round(rng.range(220, 780)),
    }
  }
  return {
    headline: `${inst.symbol} Cuts Outlook, Cites Softer Enterprise Spending`,
    body: `${inst.name} lowered its full-year revenue and margin guidance, citing longer sales cycles and softer enterprise budgets. The company now expects revenue growth in the ${rng.range(1, 6).toFixed(1)}% range versus prior expectations. Management said cost actions announced today are intended to protect profitability while demand normalizes.`,
    source: pick(rng, SOURCES), kind: 'guidance', symbols: [inst.symbol], sentiment: roundTo(-rng.range(0.5, 0.9), 2), impactBps: Math.round(-rng.range(280, 950)),
  }
}

function regulatoryNews(rng: Rng, inst: Instrument): GeneratedNews {
  const good = rng.u() < 0.42
  if (good) {
    return {
      headline: `${inst.symbol} Clears Key Regulatory Review; Approval Expected Within 90 Days`,
      body: `Regulators completed their review of ${inst.name}'s filing without major objections, according to people familiar with the matter, with final approval expected within 90 days. The company said it is prepared to begin commercialization immediately upon clearance. Analysts estimate the addressed market could add $${Math.round(rng.range(150, 1400))} million in annual revenue by year three.`,
      source: pick(rng, SOURCES), kind: 'regulatory', symbols: [inst.symbol], sentiment: roundTo(rng.range(0.4, 0.85), 2), impactBps: Math.round(rng.range(150, 520)),
    }
  }
  const fine = Math.round(rng.range(12, 480))
  return {
    headline: `Regulators Open Review Into ${inst.name} Practices; Company Vows Cooperation`,
    body: `Federal regulators opened a review of certain ${inst.name} business practices, according to a filing made public today. The company said it is cooperating fully and believes the matters are remediable without material financial impact. Legal analysts noted that comparable reviews have historically resolved with fines between $${Math.round(fine / 2)} million and $${fine * 2} million.`,
    source: pick(rng, SOURCES), kind: 'regulatory', symbols: [inst.symbol], sentiment: roundTo(-rng.range(0.35, 0.8), 2), impactBps: Math.round(-rng.range(120, 460)),
  }
}

function maNews(rng: Rng, inst: Instrument): GeneratedNews {
  const premium = Math.round(rng.range(18, 45))
  return {
    headline: `Exclusive: ${pick(rng, ['Sources Say', 'Deal Report:'])} Consortium Weighs Takeover of ${inst.symbol} at ~${premium}% Premium`,
    body: `A consortium of financial sponsors has been quietly evaluating a take-private of ${inst.name}, according to three people with direct knowledge of the matter. An offer would represent a premium of roughly ${premium}% to the current share price, though deliberations are preliminary and no formal proposal has been submitted. The company declined to comment. Board advisers are said to have begun standard preparedness work.`,
    source: pick(rng, ['Meridian Wire', 'StreetPulse', 'The Funding Ledger']), kind: 'ma', symbols: [inst.symbol], sentiment: roundTo(rng.range(0.55, 0.95), 2), impactBps: Math.round(rng.range(320, 950)),
  }
}

function insiderNews(rng: Rng, inst: Instrument): GeneratedNews {
  const buy = rng.u() < 0.45
  const amount = Math.round(rng.range(0.4, 22)) * 1e6
  const role = pick(rng, ['CEO', 'CFO', 'President', 'Chief Technology Officer', 'Director'])
  const name = pick(rng, ['R. Calloway', 'M. Tanaka', 'S. Okonkwo', 'H. Lindberg', 'P. Alvarez', 'J. Whitfield'])
  if (buy) {
    return {
      headline: `Form 4: ${inst.symbol} ${role} ${name} Buys $${(amount / 1e6).toFixed(1)}M in Open Market`,
      body: `A regulatory filing shows ${inst.name} ${role} ${name} purchased approximately $${(amount / 1e6).toFixed(1)} million of ${inst.symbol} common stock in the open market at prices between $${roundTo(inst.basePrice * 0.97, 2)} and $${roundTo(inst.basePrice * 1.01, 2)}. The purchase was described as an opportunistic accumulation. Insiders bought shares on ${Math.round(rng.range(2, 6))} separate days this month.`,
      source: pick(rng, SOURCES), kind: 'insider', symbols: [inst.symbol], sentiment: roundTo(rng.range(0.2, 0.55), 2), impactBps: Math.round(rng.range(40, 160)),
    }
  }
  return {
    headline: `Form 4: ${inst.symbol} Insider ${name} Sells $${(amount / 1e6).toFixed(1)}M Under 10b5-1 Plan`,
    body: `${inst.name} disclosed that ${role} ${name} sold approximately $${(amount / 1e6).toFixed(1)} million of stock under a pre-arranged 10b5-1 trading plan adopted earlier this year. Filings indicate the sales were scheduled and not related to any change in outlook. The executive retains a substantial equity position.`,
    source: pick(rng, SOURCES), kind: 'insider', symbols: [inst.symbol], sentiment: roundTo(-rng.range(0.1, 0.4), 2), impactBps: Math.round(-rng.range(30, 120)),
  }
}

function capitalNews(rng: Rng, inst: Instrument): GeneratedNews {
  const roll = rng.u()
  const amountB = roundTo(rng.range(0.5, 8), 1)
  if (roll < 0.4) {
    return {
      headline: `${inst.symbol} Announces $${amountB}B Share Repurchase Program`,
      body: `${inst.name}'s board authorized a new $${amountB} billion share repurchase program, replacing the prior authorization with roughly $${roundTo(amountB * rng.range(0.2, 0.6), 1)} billion remaining. Management said buybacks will be executed opportunistically and funded from free cash flow. The company has reduced share count by ${rng.range(2, 7).toFixed(1)}% over the past two years.`,
      source: pick(rng, SOURCES), kind: 'capital', symbols: [inst.symbol], sentiment: roundTo(rng.range(0.35, 0.7), 2), impactBps: Math.round(rng.range(90, 300)),
    }
  }
  if (roll < 0.7) {
    const pct = roundTo(rng.range(6, 25), 0)
    return {
      headline: `${inst.symbol} Raises Quarterly Dividend ${pct}%`,
      body: `${inst.name} declared a quarterly dividend of $${roundTo((inst.basePrice * (inst.divYield || 1.2)) / 400 * (1 + pct / 100), 2)} per share, an increase of ${pct}% and the ${Math.round(rng.range(4, 21))}th consecutive annual raise. The board cited durable cash generation and confidence in the outlook. The dividend is payable next quarter to shareholders of record.`,
      source: pick(rng, SOURCES), kind: 'capital', symbols: [inst.symbol], sentiment: roundTo(rng.range(0.25, 0.55), 2), impactBps: Math.round(rng.range(60, 200)),
    }
  }
  return {
    headline: `${inst.symbol} Prices $${amountB}B Senior Notes Offering at ${roundTo(rng.range(3.8, 6.4), 2)}%`,
    body: `${inst.name} priced an offering of senior unsecured notes, with proceeds earmarked for general corporate purposes and refinancing of upcoming maturities. The company said the transaction leaves it comfortably within its target leverage range of 2.0x–2.8x. Ratings agencies affirmed existing outlooks following the announcement.`,
    source: pick(rng, SOURCES), kind: 'capital', symbols: [inst.symbol], sentiment: roundTo(rng.range(-0.15, 0.2), 2), impactBps: Math.round(rng.range(-40, 60)),
  }
}

function legalNews(rng: Rng, inst: Instrument): GeneratedNews {
  const good = rng.u() < 0.45
  if (good) {
    return {
      headline: `${inst.symbol} Prevails in Patent Suit; Injunction Denied`,
      body: `A federal jury returned a verdict in favor of ${inst.name} in a long-running patent dispute, rejecting claims seeking $${Math.round(rng.range(80, 900))} million in damages. The company said the ruling validates its intellectual property position. Shares reacted as the risk of an injunction on core products was removed.`,
      source: pick(rng, SOURCES), kind: 'legal', symbols: [inst.symbol], sentiment: roundTo(rng.range(0.3, 0.65), 2), impactBps: Math.round(rng.range(80, 280)),
    }
  }
  return {
    headline: `Jury Awards $${Math.round(rng.range(60, 750))}M Against ${inst.symbol} Unit in Contract Dispute`,
    body: `A jury found a subsidiary of ${inst.name} liable in a commercial contract dispute and awarded damages of approximately $${Math.round(rng.range(60, 750))} million. The company said it will pursue post-trial motions and, if necessary, appeal. Legal reserves on the books cover a portion of the award, management noted.`,
    source: pick(rng, SOURCES), kind: 'legal', symbols: [inst.symbol], sentiment: roundTo(-rng.range(0.3, 0.7), 2), impactBps: Math.round(-rng.range(90, 320)),
  }
}

function macroNews(rng: Rng): GeneratedNews {
  const roll = rng.u()
  if (roll < 0.28) {
    const hold = rng.u() < 0.6
    return {
      headline: hold ? 'Fed Holds Policy Rate Steady; Signal Points to Patience Into Summer' : 'Fed Cuts Rates 25bps, Flags "Greater Confidence" on Inflation Path',
      body: hold
        ? 'The Federal Reserve left the target range for the federal funds rate unchanged, as widely expected. In its statement, the committee noted solid growth and a labor market that remains "on better balance," while reiterating that further easing depends on continued progress on inflation. Rate futures trimmed odds of a move at the next meeting.'
        : 'The Federal Reserve lowered its policy rate by 25 basis points and signaled additional normalization if inflation continues to moderate. Chair comments emphasized that policy remains restrictive. Equities extended gains and short-end yields fell following the release.',
      source: 'The Macro Desk', kind: 'macro', symbols: ['*'], sentiment: hold ? roundTo(rng.range(-0.1, 0.2), 2) : roundTo(rng.range(0.3, 0.7), 2), impactBps: Math.round(rng.range(-30, 90)),
    }
  }
  if (roll < 0.5) {
    const hot = rng.u() < 0.45
    return {
      headline: `CPI ${hot ? 'Runs Hot' : 'Cools More Than Expected'} at ${roundTo(rng.range(2.4, 3.4), 1)}%, Core ${roundTo(rng.range(2.6, 3.5), 1)}%`,
      body: hot
        ? `Consumer prices rose more than forecast, with the headline index up ${roundTo(rng.range(0.3, 0.5), 1)}% on the month. Shelter and energy contributed the largest increases. Traders pared bets on near-term easing, and Treasury yields backed up across the curve. Rate-sensitive sectors underperformed in early trading.`
        : `Consumer inflation surprised to the downside, rising just ${roundTo(rng.range(0.0, 0.2), 1)}% on the month. Core goods prices declined for a third straight month. Markets rallied on the print, with futures pricing in a higher probability of easing at the next policy meeting.`,
      source: 'The Macro Desk', kind: 'macro', symbols: ['*'], sentiment: hot ? roundTo(-rng.range(0.2, 0.5), 2) : roundTo(rng.range(0.25, 0.55), 2), impactBps: Math.round(hot ? -rng.range(30, 90) : rng.range(40, 110)),
    }
  }
  if (roll < 0.72) {
    const strong = rng.u() < 0.5
    return {
      headline: `Nonfarm Payrolls ${strong ? 'Beat' : 'Miss'} With ${Math.round(rng.range(85, 320))}K ${strong ? 'Additions' : 'Additions'}; Unemployment ${roundTo(rng.range(3.7, 4.4), 1)}%`,
      body: strong
        ? `The economy added more jobs than expected last month while the unemployment rate held near multi-decade lows. Average hourly earnings rose ${roundTo(rng.range(0.2, 0.5), 1)}%. Equity index futures firmed as growth fears eased, though bond yields ticked higher on the strong print.`
        : `Payroll growth slowed more than expected and prior months were revised lower by a combined ${Math.round(rng.range(20, 90))}K. The participation rate edged down. Investors read the report as increasing the odds of policy support, with defensives and utilities outperforming.`,
      source: 'The Macro Desk', kind: 'macro', symbols: ['*'], sentiment: strong ? roundTo(rng.range(0.1, 0.4), 2) : roundTo(-rng.range(0.1, 0.35), 2), impactBps: Math.round(strong ? rng.range(20, 80) : -rng.range(20, 70)),
    }
  }
  if (roll < 0.88) {
    const sector = pick(rng, ['Technology', 'Energy', 'Financials', 'Healthcare', 'Consumer'])
    return {
      headline: `${sector} Shares Rally as Rotation Broadens; Sector Index at Multi-Week Highs`,
      body: `Institutional flows rotated into ${sector.toLowerCase()} names for a third consecutive session, desk commentary noted. Breadth improved with ${Math.round(rng.range(60, 90))}% of sector constituents advancing. Options activity suggests continued hedged upside positioning into month-end rebalancing.`,
      source: pick(rng, ['StreetPulse', 'Capital Markets Daily', 'Quant Feed']), kind: 'color', symbols: ['@' + sector], sentiment: roundTo(rng.range(0.15, 0.45), 2), impactBps: Math.round(rng.range(25, 90)),
    }
  }
  return {
    headline: pick(rng, [
      'Overnight Futures Steady as Traders Await Data; Volatility Gauge Slips',
      'Dollar Softens, Commodities Mixed Ahead of Busy Data Week',
      'Index Rebalancing Expected to Add $2.1B of Flow at the Close',
      'Meridian Composite Extends Win Streak to Four Sessions on Breadth',
    ]),
    body: 'Market technicians noted orderly conditions across the session with liquidity metrics near seasonal norms. Desk commentary described balanced two-way flow and no signs of stress in funding markets. Attention now shifts to upcoming data releases and the next round of earnings.',
    source: pick(rng, ['Meridian Wire', 'Capital Markets Daily', 'Quant Feed']), kind: 'color', symbols: ['*'], sentiment: roundTo(rng.range(-0.1, 0.2), 2), impactBps: Math.round(rng.range(-25, 45)),
  }
}

export function makeEarningsNews(inst: Instrument, actualEps: number, estEps: number, revBeatPct: number, guideUp: boolean | null): GeneratedNews {
  const beat = actualEps >= estEps
  const surprisePct = estEps !== 0 ? ((actualEps - estEps) / Math.abs(estEps)) * 100 : 0
  const revWord = revBeatPct > 1 ? 'above' : revBeatPct < -1 ? 'below' : 'in line with'
  const epsStr = actualEps < 0 ? `($${Math.abs(actualEps).toFixed(2)})` : `$${actualEps.toFixed(2)}`
  const estStr = `$${estEps.toFixed(2)}`
  const guideStr = guideUp === null ? 'in-line guidance' : guideUp ? 'above-consensus guidance' : 'guidance below consensus'
  const sentiment = Math.max(-0.95, Math.min(0.95, surprisePct / 14 + revBeatPct / 6 + (guideUp === null ? 0 : guideUp ? 0.25 : -0.3)))
  const impactBps = Math.round(Math.max(-1800, Math.min(1800, sentiment * rng_likeImpact())))
  function rng_likeImpact(): number {
    return 350 + Math.abs(surprisePct) * 55
  }
  return {
    headline: `${inst.symbol} ${beat ? 'Beats' : 'Misses'} on Q${1 + Math.floor(Math.random() * 4)} Earnings: EPS ${epsStr} vs ${estStr} Est.${beat ? '' : ' — Shares Slide Premarket'}`,
    body: `${inst.name} reported quarterly EPS of ${epsStr} versus consensus of ${estStr}, a surprise of ${surprisePct >= 0 ? '+' : ''}${surprisePct.toFixed(1)}%. Revenue came in ${revWord} expectations at $${(inst.shares * inst.basePrice * 0.000042).toFixed(2)} billion for the quarter. Management issued ${guideStr}, and the stock is ${beat ? 'higher' : 'under pressure'} in extended trading. Analysts flagged margin trajectory as the key metric to watch into the next print.`,
    source: 'Meridian Wire', kind: 'earnings', symbols: [inst.symbol], sentiment: roundTo(sentiment, 2), impactBps,
  }
}

/** choose and generate a random market event */
export function generateRandomEvent(rng: Rng, symbolsByCap: Instrument[]): GeneratedNews {
  const kind = rng.weighted<string>([
    ['analyst', 24],
    ['product', 15],
    ['guidance', 8],
    ['regulatory', 7],
    ['ma', 5],
    ['insider', 9],
    ['capital', 9],
    ['macro', 9],
    ['legal', 6],
    ['color', 8],
  ])
  if (kind === 'macro' || kind === 'color') {
    return kind === 'macro' ? macroNews(rng) : macroNews(rng) // color handled inside macroNews tail
  }
  // symbol weighted by market cap rank (bigger caps make news more often)
  const idx = Math.min(symbolsByCap.length - 1, Math.floor(Math.pow(rng.u(), 1.6) * symbolsByCap.length))
  const inst = symbolsByCap[idx]
  switch (kind) {
    case 'analyst': return analystAction(rng, inst)
    case 'product': return productNews(rng, inst)
    case 'guidance': return guidanceNews(rng, inst)
    case 'regulatory': return regulatoryNews(rng, inst)
    case 'ma': return maNews(rng, inst)
    case 'insider': return insiderNews(rng, inst)
    case 'capital': return capitalNews(rng, inst)
    case 'legal': return legalNews(rng, inst)
    // v8 ignore next 2 — kind is constrained by the weighted pick above
    /* v8 ignore next 2 */
    default:
      return macroNews(rng)
  }
}

export function makeHaltNews(symbol: string, reason: string): GeneratedNews {
  return {
    headline: `MRX Halts Trading in ${symbol} — ${reason}`,
    body: `The Meridian Exchange paused trading in ${symbol} at 14:32:07 UTC under its volatility control program after the stock breached short-swing price band thresholds. Trading will resume via a five-minute price discovery auction. Market participants may enter orders but executions are suppressed until the auction concludes.`,
    source: 'MRX Newsroom', kind: 'halt', symbols: [symbol], sentiment: 0, impactBps: 0,
  }
}
