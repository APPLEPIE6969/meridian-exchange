// MRX company profiles — business summaries, product lines, and financial
// baselines for every operating issuer in the composite universe.
// Financial baselines feed the deterministic quarterly-financials generator.

import { Rng, roundTo } from './rng'
import { BY_SYMBOL, Instrument } from './universe'

export interface CompanyProfile {
  summary: string
  products: string[]
  revenueTtm: number // $B, trailing twelve months
  revGrowth: number // % yoy
  grossMargin: number // %
  netMargin: number // %
}

const P = (
  summary: string,
  products: string[],
  revenueTtm: number,
  revGrowth: number,
  grossMargin: number,
  netMargin: number,
): CompanyProfile => ({ summary, products, revenueTtm, revGrowth, grossMargin, netMargin })

export const PROFILES: Record<string, CompanyProfile> = {
  // ─── Semiconductors & Hardware ───────────────────────────────────────────
  QNTM: P(
    'Quantum Dynamics is the largest semiconductor company in the Meridian universe, designing the processor architectures that power a majority of hyperscale AI training clusters. The company operates a hybrid manufacturing model, retaining leading-edge packaging and quantum co-processor fabrication in-house while outsourcing commodity logic to foundry partners. Its automotive and edge businesses have grown into the second pillar of revenue over the past three years.',
    ['Q-Series HX Data Center Processors', 'QNA-9 Accelerator Cards', 'Quantum-Assisted Simulation Cloud (QAS)', 'Aurora Automotive SoC Platform', 'EdgeQ Neural Modules'],
    68.4, 34.2, 62.1, 27.8,
  ),
  VLTR: P(
    'Voltrix Semiconductor is the leading supplier of power management silicon for AI data centers, where rack densities above 100kW have made efficient power delivery the primary constraint on cluster buildouts. The company holds the top share in vertical power modules and has been ramping 48V backplane solutions with every major hyperscaler.',
    ['VoltCore PMIC Family', 'Helios 48V Power Stages', 'NXR Rack-Scale Power Modules', 'SilMax GaN FETs'],
    9.8, 22.4, 55.3, 21.6,
  ),
  LUMCR: P(
    'Lumicore Devices designs silicon photonics and co-packaged optical interconnects that link AI accelerators across data center halls. As electrical SerDes approaches its bandwidth limits, Lumicore\'s optical circuit switches have become the default choice for the new generation of GPU clusters, and the company is sold out through next year.',
    ['LumaLink 800G Optical Transceivers', 'Co-Packaged Optics (CPO) Switches', 'PhotonIQ DSP Cores', 'FiberSense Monitoring Chips'],
    2.9, 18.6, 44.2, 9.4,
  ),
  KRYO: P(
    'Kryotherm Industries builds cryogenic cooling and precision thermal management systems for semiconductor fabrication, quantum computing laboratories, and satellite payloads. The company occupies a narrow but defensible niche: there are only three qualified suppliers of the helium-cycle chillers used in extreme-ultraviolet lithography, and Kryotherm is one of them.',
    ['CryoVault Helium-Cycle Chillers', 'ThermoGuard Wafer Temperature Systems', 'PolarSat Space Radiators', 'LabCryo Benchtop Units'],
    1.1, 9.2, 38.4, 8.1,
  ),
  SILVX: P(
    'Silvex Materials produces the specialty consumables that leading-edge chip fabs cannot operate without: ultra-pure wafer substrates, photoresists, and atomic-layer deposition precursors. Revenue is highly recurring, with single-source supply agreements covering roughly 70% of volume, and pricing is typically negotiated on multi-year contracts.',
    ['UltraPure 300mm Substrates', 'Photicore EUV Photoresists', 'AtomLayer ALD Precursors', 'EtchSelect Etching Chemistries'],
    3.4, 12.1, 41.3, 11.2,
  ),

  // ─── Software & Cloud ────────────────────────────────────────────────────
  AXNDA: P(
    'Axenda Software Group operates the leading revenue-automation platform, combining CRM, quoting, and billing in a single system of record used by more than 14,000 enterprises. The company has successfully migrated its base to consumption-based pricing over the last two years, and its agent-assist AI layer is now attached to roughly 60% of renewals.',
    ['Axenda Revenue Cloud', 'Quotely CPQ', 'Axenda Billing Engine', 'Atlas Agent Assist (AI)', 'Pulse Analytics Suite'],
    9.6, 19.4, 74.2, 14.1,
  ),
  CLDU: P(
    'Celdune Platforms provides a cloud-native data platform for streaming ingestion, distributed storage, and real-time analytics at petabyte scale. The company rides the structural shift from batch to streaming architectures, and its table format has become an open industry standard adopted by the three largest cloud providers.',
    ['Celdune StreamGrid', 'LakeFort Distributed Storage', 'RealTime Query Engine', 'Celdune DataMesh Connect'],
    3.4, 24.1, 69.4, 8.2,
  ),
  VNTQ: P(
    'Vantaq Systems is the fastest-growing identity-security platform in the Meridian universe, delivering secrets management, workload identity, and compliance automation for cloud estates. Recent high-profile breaches at competitors have driven an influx of enterprise migrations, and federal agencies now account for a growing share of bookings.',
    ['Vantaq Vault (Secrets Management)', 'WorkID Workload Identity', 'ComplyAuto Compliance Suite', 'Vantaq Edge Agents'],
    1.4, 31.2, 72.3, 5.4,
  ),
  CDXR: P(
    'Codexa Corporation builds AI-powered code intelligence tools used by engineering organizations at the majority of Fortune 500 firms. Its coding agents have moved from autocomplete to autonomous multi-file task execution, and the company reports that paid seat expansion now contributes more growth than new customer acquisition.',
    ['Codexa Copilot Agents', 'ReviewLoop Automated Code Review', 'Codexa Enterprise IDE', 'TestForge AI Test Generation'],
    2.6, 28.3, 76.1, 9.8,
  ),
  OCTEQ: P(
    'Octeq Digital operates a commerce-media network connecting retailer first-party data with demand-side advertising platforms. The segment has been one of the fastest-growing areas of digital advertising, and Octeq holds preferred integrations with six of the ten largest U.S. retailers.',
    ['Octeq Commerce Network', 'AudienceGraph Identity Resolution', 'RetailMedia Console', 'SignalPipe CDP'],
    2.2, 14.2, 58.2, 6.3,
  ),
  NEURX: P(
    'Neuraflux AI operates large-scale inference infrastructure, selling model-serving capacity to enterprises and application developers. The company runs one of the three largest dedicated GPU fleets in the world and has shifted its mix toward long-duration enterprise contracts with reserved capacity, which now cover more than half of forward revenue.',
    ['NeuraCore Inference API', 'Reserved Capacity Contracts', 'FluxStudio Model Fine-Tuning', 'Neuraflux Edge Inference Nodes'],
    8.9, 48.2, 58.4, 16.2,
  ),
  SYNTQ: P(
    'Syntiq Corporation sells machine-learning operations software for model training, evaluation, and governance, with particular strength in regulated industries. Banks, insurers, and healthcare systems use Syntiq to satisfy model-risk requirements, giving the company unusually sticky, compliance-driven renewals.',
    ['Syntiq TrainOps', 'ModelAudit Governance Console', 'EvalBench Evaluation Suite', 'Syntiq Data Lineage Tracker'],
    2.7, 36.4, 71.2, 11.4,
  ),
  QUBIQ: P(
    'Qubiq Analytics applies causal inference and simulation to supply-chain and pricing decisions, letting enterprises stress-test decisions against thousands of simulated futures. The company is still sub-scale and unprofitable but has doubled headcount in sales over the past year while maintaining net revenue retention above 130%.',
    ['Qubiq Scenario Engine', 'SupplySim Digital Twin', 'PricePath Optimization', 'Qubiq Causal Studio'],
    0.9, 40.1, 68.3, 3.2,
  ),

  // ─── Financials ──────────────────────────────────────────────────────────
  MRDN: P(
    'Meridian Financial Group is a diversified financial services holding company founded in 1932, spanning life insurance, annuities, retirement solutions, and institutional asset management. The insurance block provides a stable base of recurring earnings and investable float, while the asset management arm has been gathering net inflows into its active ETF lineup.',
    ['Meridian Life & Annuities', 'Meridian Retirement Plans (401k/Pension)', 'Meridian Asset Management', 'Meridian Private Wealth'],
    24.6, 6.2, 24.1, 11.3,
  ),
  AXBK: P(
    'Axiom Bancorp is a national banking corporation tracing its charter to 1889, providing commercial lending, treasury services, and consumer banking across 2,100 branches. The balance sheet is asset-sensitive, and management has been expanding the fee businesses — payments, wealth, and capital markets — to reduce reliance on net interest income.',
    ['Axiom Commercial Banking', 'Axiom Treasury & Payments', 'Axiom Consumer Mortgage', 'Axiom Wealth Management'],
    18.2, 5.1, 58.3, 26.4,
  ),
  VSTRA: P(
    'Vestra Capital is an alternative asset manager focused on private credit, real assets, and liquid alternative strategies, with $182 billion under management. The firm has been a major beneficiary of the post-2023 private-credit boom, and management fees on perpetual capital vehicles now represent roughly 60% of revenue.',
    ['Vestra Private Credit Funds', 'Vestra Real Assets Infrastructure', 'Vestra Liquid Alternatives', 'Vestra Insurance Solutions (RIA)'],
    1.9, 11.4, 46.2, 18.3,
  ),
  GNRY: P(
    'Granary Bancshares is a community banking franchise serving agricultural and small-business clients throughout the upper Midwest since 1927. The bank is a leading originator of USDA-backed farm loans, and its deposit base — heavily retail and agricultural — has proven exceptionally stable through rate cycles.',
    ['Granary Farm & Ag Lending', 'Granary Small Business Banking', 'Granary Crop Insurance Services', 'Rural Residential Mortgages'],
    0.9, 4.2, 61.4, 27.2,
  ),

  // ─── Healthcare ──────────────────────────────────────────────────────────
  HELX: P(
    'Helixion Therapeutics is a commercial-stage biopharmaceutical company focused on immunology and rare autoimmune diseases, with three approved therapies on the market. The lead franchise continues to gain share in rheumatology, and a subcutaneous formulation filed this year could extend exclusivity into the next decade.',
    ['Helvora (rheumatoid arthritis)', 'Imunex-Q (rare autoimmune)', 'DermaHelx (psoriasis topical)', 'Pipeline: HX-214 Phase 3'],
    5.4, 12.3, 78.2, 14.1,
  ),
  ZRNX: P(
    'Zernova Bio is a clinical-stage biotechnology company developing gene-editing therapies for hematologic disorders, led by a Phase 2b candidate for sickle cell disease. The company has no approved products and funds operations through its cash position and a milestone-funded partnership with a large pharma licensee.',
    ['ZRN-101 (sickle cell, Phase 2b)', 'ZRN-204 (beta-thalassemia, Phase 1)', 'EditPayload LNP Delivery Platform'],
    0.06, 62.4, 52.1, -142.3,
  ),
  MENDL: P(
    'Mendelis Health is a medical device manufacturer specializing in patient monitoring, respiratory care, and diagnostic consumables, with installed equipment in over 6,000 hospitals. The razor-and-blade model — monitors placed at low margin, consumables and subscriptions recurring — produces one of the most durable revenue profiles in medtech.',
    ['Mendelis VitalSync Monitors', 'AiraRes Ventilator Line', 'Guardian Remote Cardiac Patches', 'Consumables & Sensor Cartridges'],
    7.8, 7.2, 61.3, 13.4,
  ),
  CRDSP: P(
    'Cardiospan Medical develops wearable cardiac diagnostics and remote arrhythmia-monitoring services sold to health systems and payers. The company has converted its device business into a recurring service model billed per study, and reimbursement coverage now extends to all major U.S. insurers.',
    ['CardioPatch Wearable ECG', 'RhythmCloud Monitoring Service', 'Cardiospan Analytics (AI triage)', 'Post-Discharge Monitoring Program'],
    0.9, 21.3, 64.2, 4.8,
  ),

  // ─── Energy ──────────────────────────────────────────────────────────────
  TERRV: P(
    'Terova Energy is a diversified exploration and production company with core positions in the Permian Basin and the Gulf, producing roughly 640 thousand barrels of oil equivalent per day. Management returns at least 60% of free cash flow to shareholders through buybacks and a fixed dividend, with the remainder allocated to debt reduction.',
    ['Permian Shale Operations', 'Gulf Deepwater Assets', 'Terova Midstream Services', 'Terova Trading & Marketing'],
    11.7, -6.2, 52.3, 15.1,
  ),
  PLCN: P(
    'Pelicon Energy is an offshore drilling contractor operating a fleet of eight ultra-deepwater drillships, all currently contracted with an average remaining term of 3.4 years. Dayrates have re-rated sharply over the past two years as deepwater exploration returned to favor, and the company has optioned two newbuild hulls.',
    ['Ultra-Deepwater Drillship Fleet', 'Pelicon Well Management', 'Subsea Intervention Services'],
    6.1, 3.4, 38.2, 18.4,
  ),
  HLXQ: P(
    'Heliqen Power develops utility-scale solar, battery storage, and green hydrogen production facilities across North America and Iberia. The company remains loss-making as it scales, but its contracted backlog of 14.2 GW provides multi-year revenue visibility, and the hydrogen segment benefits from production tax credits.',
    ['Heliqen Solar Parks', 'GridStor Battery Systems', 'H2 Novum Green Hydrogen Plants', 'Heliqen O&M Services'],
    1.1, 27.4, 34.2, -8.2,
  ),
  PETQ: P(
    'Petraquin Midstream Partners owns and operates refined-product pipelines, terminals, and export facilities along the Gulf Coast. Roughly 85% of revenue comes from fee-based, take-or-pay contracts insulated from commodity prices, and the partnership is structured as a high-yield distribution vehicle.',
    ['Gulf Coast Product Pipelines', 'Petraquin Terminal Network', 'Export Docks & Storage', 'Petraquin NGL Services'],
    4.6, 2.1, 28.4, 19.2,
  ),
  NDRX: P(
    'Netherfield Resources operates oil sands and thermal production assets in Alberta with integrated upgrading capacity and long-life, low-decline reserves. The company\'s cost per barrel sits in the lowest quartile of the Canadian peer group, and it ships the majority of its volumes on contracted pipeline capacity to the Gulf Coast.',
    ['Oil Sands Mining & Upgrading', 'Thermal In-Situ Operations', 'Netherfield Pipelines (Alberta Fund)', 'Blending & Logistics'],
    3.8, -3.1, 41.2, 12.4,
  ),

  // ─── Consumer ────────────────────────────────────────────────────────────
  KRAVN: P(
    'Kraven Retail Group operates 1,840 discount variety stores across the United States, offering groceries, general merchandise, and pharmacy services, primarily in towns under 20,000 residents. The proximity-store model has kept same-store sales positive for eleven consecutive quarters despite discretionary pressure.',
    ['Kraven Discount Stores', 'Kraven Pharmacy', 'KravenFresh Grocery', 'Kraven.com Pickup & Delivery'],
    68.2, 5.1, 24.3, 2.6,
  ),
  DOLCI: P(
    'Dolciva Foods is a packaged foods company producing confectionery, bakery, and snack brands distributed in 40 countries. The portfolio skews toward resilient categories with strong brand equity, and the company has been pruning tail SKUs while investing behind its five billion-dollar brands.',
    ['Dolciva Chocolate', 'Graham\'s Bakery Co.', 'SnackHaus Pretzels & Chips', 'Dolciva International Export'],
    3.6, 3.2, 34.1, 9.3,
  ),
  AURQ: P(
    'Aurique Apparel is a fast-fashion retailer with a vertically integrated design-to-shelf cycle measured in weeks, operating 900 stores across three continents alongside a growing app-led digital business. The company\'s speed advantage lets it chase micro-trends faster than legacy competitors, though it remains exposed to inventory risk when trends miss.',
    ['Aurique Stores', 'AURQ App & Online', 'Aurique Studio (exclusive lines)', 'Aurique Beauty'],
    4.1, 12.4, 47.2, 5.1,
  ),
  BASTN: P(
    'Bastion Home Goods is a home improvement and furnishings retailer operating big-box stores and a rapidly growing e-commerce platform. Housing turnover has been depressed, but management has leaned into project-based demand — kitchen, bath, and garden renovations — which carries higher ticket sizes and attachment rates.',
    ['Bastion Warehouse Stores', 'Bastion Design Centers', 'Bastion.com', 'Bastion Pro Contractor Program'],
    6.3, 6.1, 33.4, 7.2,
  ),
  VOLTQ: P(
    'Voltique Motors designs and manufactures electric vehicles, stationary energy storage systems, and charging infrastructure across North America, Europe, and Asia. The company reached sustained operating profitability this fiscal year on record deliveries, and its energy storage segment is now growing faster than the automotive business.',
    ['Voltique Model S/C/E lineup', 'Voltique Powerwall Home Storage', 'GridVolt Utility Storage', 'VoltCharge Network (28,400 stalls)'],
    41.2, 11.3, 19.4, 4.2,
  ),
  DRVML: P(
    'Drivemile Mobility operates rideshare and micromobility marketplaces in 220 metropolitan areas, with a fast-growing advertising business layered on top of its first-party trip data. The company turned free-cash-flow positive last year and has been returning capital while maintaining category-leading take rates.',
    ['Drivemile Rideshare', 'Drivemile Eats Delivery', 'Spin Scooters & Micromobility', 'Drivemile Ads Network'],
    6.8, 14.2, 42.1, -6.3,
  ),
  HYDQ: P(
    'Hydroq Motors develops hydrogen fuel-cell Class 8 trucks and the refueling infrastructure to support regional freight corridors. Pre-revenue scaling remains expensive and the company continues to post deep losses, but two state-backed corridor networks came online this year, and the order book now exceeds 4,200 units.',
    ['Hydroq FC-8 Truck', 'HyFill Corridor Stations', 'FleetOS Fleet Management', 'Hydroq Leasing Partners'],
    0.4, 44.2, 18.1, -88.4,
  ),

  // ─── Industrials ─────────────────────────────────────────────────────────
  ATKR: P(
    'Atlascore Industries is a diversified industrial manufacturer producing flow-control equipment, precision bearings, and industrial automation systems, with over a century of operating history. Roughly 70% of revenue is aftermarket parts and services, and the backlog sits at a record on data-center HVAC and energy-infrastructure demand.',
    ['Atlascore Flow Systems (valves/pumps)', 'Precision Bearing Division', 'Atlascore Industrial Automation', 'Aftermarket & Field Services'],
    16.4, 8.2, 36.3, 14.1,
  ),
  VELR: P(
    'Velaero Aerospace is a defense contractor delivering satellite systems, missile guidance, and space launch services to government and commercial customers. Geopolitical spending cycles have lifted its classified portfolio, and the launch services unit has been winning commercial constellation deployment contracts against cheaper but less reliable rivals.',
    ['Velaero Satellite Systems', 'Guidance & Missile Systems', 'Velaero Launch Services (VLS-1)', 'Classified Space Programs'],
    8.7, 7.4, 29.2, 9.1,
  ),
  IRWQ: P(
    'Ironworks Manufacturing specializes in steel fabrication and industrial components for construction, energy transmission, and rail markets. It is a classic cyclical with thin margins and high operating leverage, currently benefiting from transmission-tower and railcar backlogs that extend into next year.',
    ['Structural Steel Fabrication', 'Transmission Towers & Poles', 'Railcar Components', 'Ironworks Bridge Products'],
    2.4, 2.3, 17.4, 5.2,
  ),
  GRXN: P(
    'Gearon Dynamics designs warehouse robotics, autonomous material-handling systems, and industrial machine-vision platforms. E-commerce fulfillment operators keep expanding deployments, and the company\'s new fleet-management software layer is converting one-time robot sales into recurring software revenue.',
    ['GearBot AMR Fleet', 'SortCore Automation Systems', 'Gearon Vision (machine vision)', 'FleetIQ Software Suite'],
    2.4, 23.2, 47.3, 8.4,
  ),

  // ─── Communication ───────────────────────────────────────────────────────
  STRMQ: P(
    'Streamquill Media is a subscription streaming service with 68 million households and a growing slate of live sports rights. The company has tightened password sharing, launched an ad-supported tier that now represents 40% of new signups, and guided to sustained positive free cash flow after years of content-spend-driven losses.',
    ['Streamquill (SVOD)', 'Streamquill Live Sports', 'AdTier by Streamquill', 'Streamquill Studios (originals)'],
    12.8, 14.1, 41.3, 8.2,
  ),
  WVLN: P(
    'Wavelink Communications is a telecom infrastructure operator managing fiber backbone, tower assets, and wholesale bandwidth for carriers. Essentially all revenue is contracted, and the company has been monetizing surplus fiber pairs through dark-fiber leases to data-center interconnect builders.',
    ['National Fiber Backbone', 'Wavelink Tower Portfolio (12,400 sites)', 'Wholesale Bandwidth & Roaming', 'DarkFiber Leasing'],
    11.4, 3.2, 52.4, 12.1,
  ),
  PXLQ: P(
    'Pixelqon Studios is an interactive entertainment studio behind the Everforge franchise and a portfolio of live-service titles. Live-service microtransactions now generate 70% of bookings, giving the business a recurring profile unusual for the games industry, though release slates remain lumpy.',
    ['Everforge MMORPG', 'Riftline Battle Royale', 'Pixelqon Live Services Store', 'Everforge Esports League'],
    3.2, 16.2, 68.4, 17.3,
  ),

  // ─── Utilities ───────────────────────────────────────────────────────────
  GRTD: P(
    'Gridstone Utilities is a regulated electric utility serving 4.1 million customer accounts, with an accelerating grid-modernization program approved through 2031. Data-center interconnection requests in its territory have tripled, and management has raised its capital plan twice in eighteen months to meet the load.',
    ['Regulated Electric Distribution', 'Grid Modernization Program', 'Gridstone Renewable Contracts', 'Data-Center Interconnection Services'],
    6.9, 6.3, 54.2, 15.1,
  ),
  AQFR: P(
    'Aquifer Resources is a water utility and infrastructure services provider operating across the arid Southwest, where population growth keeps rate-base expansion on a steady path. Conservation mandates have not dented earnings, as approved decoupling mechanisms let the utility recover fixed costs regardless of volumes.',
    ['Water Distribution & Treatment', 'Aquifer Infrastructure Services', 'Reuse & Desalination Projects', 'Municipal Contracts'],
    2.2, 7.1, 46.3, 14.2,
  ),
}

// ETFs — no product lines; sector-exposure description lives in the universe.
export function profileOf(symbol: string): CompanyProfile | null {
  return PROFILES[symbol] ?? null
}

// ─── Deterministic quarterly financials ─────────────────────────────────────

export interface QuarterFinancial {
  quarter: string
  reportDate: string
  epsActual: number
  epsEstimate: number
  epsSurprise: number // %
  revenueB: number // $B for the quarter
  revYoY: number // % vs same quarter prior year
}

/** deterministic 8-quarter financial history ending just before `nextReportMs` */
export function buildQuarterFinancials(inst: Instrument, nextReportMs: number): QuarterFinancial[] {
  const prof = PROFILES[inst.symbol]
  const rng = new Rng(`fin-${inst.symbol}`)
  const out: QuarterFinancial[] = []
  const qRevBase = (prof?.revenueTtm ?? (inst.shares * inst.basePrice * 0.000168) / 1e9) / 4
  const growthQ = (prof?.revGrowth ?? 6) / 100 / 4

  // report dates walking back from the upcoming report, ~91 days per quarter.
  // reportDates[0] = most recent reported ... reportDates[7] = oldest.
  const reportDates: number[] = []
  {
    let ms = nextReportMs
    for (let i = 0; i < 8; i++) {
      ms = ms - (91 + Math.floor(rng.u() * 8)) * 86400000
      reportDates.push(ms)
    }
  }
  // build chronological rows: back=7 (oldest) → back=0 (most recent reported)
  // quarter labels follow a strict calendar-quarter cadence anchored at the most
  // recent report, so labels never skip regardless of date jitter.
  const anchor = new Date(reportDates[0] - 40 * 86400000) // quarter ended ~6wks before report
  let qLabel = Math.floor(anchor.getUTCMonth() / 3) + 1 // 1..4
  let qYear = anchor.getUTCFullYear()
  const labels: string[] = []
  for (let i = 0; i < 8; i++) {
    labels.unshift(`Q${qLabel} ${qYear}`)
    qLabel -= 1
    if (qLabel === 0) { qLabel = 4; qYear -= 1 }
  }
  const rows: { label: string; date: number; eps: number; est: number; rev: number }[] = []
  for (let back = 7; back >= 0; back--) {
    const reportMs = reportDates[back]
    const d = new Date(reportMs - 40 * 86400000) // quarter ended ~6wks before report
    const label = labels[7 - back]
    const seasonality = 1 + 0.09 * Math.sin((d.getUTCMonth() / 12) * Math.PI * 2 + (inst.kind === 'etf' ? 0 : hashOf(inst.symbol) % 3))
    const ageFactor = Math.pow(1 + growthQ, -back) // older quarters slightly smaller
    const revNoise = 1 + rng.gauss() * 0.035
    const rev = Math.max(0.01, qRevBase * seasonality * ageFactor * revNoise)
    const baseEps = Math.abs(inst.estEps) || 0.2
    const epsNoise = 1 + rng.gauss() * 0.12
    const actual = (inst.estEps >= 0 ? 1 : -1) * baseEps * epsNoise * (1 - back * growthQ * 0.4)
    const surprise = rng.gauss() * 0.045 + (rng.u() < 0.62 ? 0.035 : -0.03)
    const est = actual / (1 + surprise)
    rows.push({ label, date: reportMs, eps: roundTo(actual, 2), est: roundTo(est, 2), rev: roundTo(rev, 2) })
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const prev = i >= 4 ? rows[i - 4] : null
    const revYoY = prev ? ((r.rev / prev.rev) - 1) * 100 : ((prof?.revGrowth ?? 6) * (0.8 + rng.u() * 0.4))
    // v8 ignore next — est is derived as actual/(1+surprise), never exactly 0
    /* v8 ignore next */
    const surprisePct = r.est !== 0 ? ((r.eps - r.est) / Math.abs(r.est)) * 100 : 0
    out.push({
      quarter: r.label,
      reportDate: new Date(r.date).toISOString().slice(0, 10),
      epsActual: r.eps,
      epsEstimate: r.est,
      epsSurprise: roundTo(surprisePct, 1),
      revenueB: r.rev,
      revYoY: roundTo(revYoY, 1),
    })
  }
  return out
}

function hashOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** consensus estimate for the upcoming report (deterministic per symbol+period) */
export function nextEarningsConsensus(inst: Instrument, nextReportMs: number): { eps: number; revenueB: number } {
  const prof = PROFILES[inst.symbol]
  const rng = new Rng(`cons-${inst.symbol}-${Math.floor(nextReportMs / 86400000)}`)
  const qRev = (prof?.revenueTtm ?? (inst.shares * inst.basePrice * 0.000168) / 1e9) / 4
  const eps = inst.estEps * (1 + rng.gauss() * 0.06)
  return { eps: roundTo(eps, 2), revenueB: roundTo(qRev * (1 + rng.gauss() * 0.03), 2) }
}
