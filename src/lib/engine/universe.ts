// MRX instrument universe — 42 operating companies + 6 sector ETFs.
// All issuers are members of the Meridian composite universe.

export type Sector =
  | 'Technology'
  | 'Financials'
  | 'Healthcare'
  | 'Energy'
  | 'Consumer'
  | 'Industrials'
  | 'Communication'
  | 'Utilities'

export interface Instrument {
  symbol: string
  name: string
  sector: Sector
  kind: 'stock' | 'etf'
  basePrice: number
  shares: number // shares outstanding
  avgVol: number // average daily volume (shares)
  beta: number
  divYield: number // annual %, 0 = none
  volAnn: number // baseline annualized volatility (%)
  estEps: number // consensus EPS (ttm)
  founded: number
  employees: number
  hq: string
  ceo: string
  description: string
}

const S = (
  symbol: string,
  name: string,
  sector: Sector,
  basePrice: number,
  sharesM: number,
  avgVolM: number,
  beta: number,
  divYield: number,
  volAnn: number,
  estEps: number,
  founded: number,
  employees: number,
  hq: string,
  ceo: string,
  description: string,
): Instrument => ({
  symbol,
  name,
  sector,
  kind: 'stock',
  basePrice,
  shares: Math.round(sharesM * 1e6),
  avgVol: Math.round(avgVolM * 1e6),
  beta,
  divYield,
  volAnn,
  estEps,
  founded,
  employees,
  hq,
  ceo,
  description,
})

const E = (
  symbol: string,
  name: string,
  sector: Sector,
  basePrice: number,
  avgVolM: number,
  volAnn: number,
  description: string,
): Instrument => ({
  symbol,
  name,
  sector,
  kind: 'etf',
  basePrice,
  shares: 100_000_000,
  avgVol: Math.round(avgVolM * 1e6),
  beta: 1.0,
  divYield: 1.2,
  volAnn,
  estEps: 0,
  founded: 2013,
  employees: 0,
  hq: 'New York, NY',
  ceo: '—',
  description,
})

export const INSTRUMENTS: Instrument[] = [
  // ─── Semiconductors & Hardware ───────────────────────────────────────────
  S('QNTM', 'Quantum Dynamics Corporation', 'Technology', 612.4, 1900, 38, 1.35, 0.4, 42, 8.85, 1998, 48200, 'Santa Clara, CA', 'Marcus Trevelyan', 'Designs and manufactures advanced processors and quantum-assisted computing platforms for data center, edge, and automotive markets.'),
  S('VLTR', 'Voltrix Semiconductor', 'Technology', 187.25, 1200, 22, 1.28, 0.5, 45, 4.12, 2005, 21400, 'Austin, TX', 'Priya Raghunathan', 'Fabless semiconductor company specializing in power management ICs and high-efficiency silicon for AI accelerators.'),
  S('LUMCR', 'Lumicore Devices', 'Technology', 47.8, 850, 9, 1.22, 0.8, 28, 1.92, 2001, 12800, 'San Jose, CA', 'Elena Vasquez', 'Develops silicon photonics and optical interconnect components for hyperscale data centers and telecom networks.'),
  S('KRYO', 'Kryotherm Industries', 'Technology', 23.6, 310, 4.2, 1.1, 1.1, 30, 1.05, 1987, 5600, 'Boise, ID', 'Douglas Whitfield', 'Supplies advanced thermal management and cryogenic cooling systems for semiconductor fabrication and research laboratories.'),
  S('SILVX', 'Silvex Materials', 'Technology', 88.15, 210, 3.1, 1.4, 0, 38, 3.4, 1996, 4300, 'Chandler, AZ', 'Hana Yoshida', 'Produces specialty wafer substrates, photoresists, and deposition materials used in leading-edge chip fabrication.'),

  // ─── Software & Cloud ────────────────────────────────────────────────────
  S('AXNDA', 'Axenda Software Group', 'Technology', 134.9, 780, 11, 1.15, 0.6, 30, 3.98, 2004, 15600, 'San Francisco, CA', 'Jonathan Meyer', 'Enterprise SaaS platform for revenue operations, providing CRM, quoting, and billing infrastructure to over 14,000 customers.'),
  S('CLDU', 'Celdune Platforms', 'Technology', 71.3, 640, 7.8, 1.2, 0, 32, 1.86, 2011, 9800, 'Seattle, WA', 'Amara Okafor', 'Cloud-native data platform offering distributed storage, streaming ingestion, and real-time analytics at petabyte scale.'),
  S('VNTQ', 'Vantaq Systems', 'Technology', 56.45, 420, 5.5, 1.3, 0, 35, 0.94, 2013, 5200, 'Boston, MA', 'Sarah Lindqvist', 'Developer-first security platform delivering secrets management, workload identity, and compliance automation for cloud estates.'),
  S('CDXR', 'Codexa Corporation', 'Technology', 102.75, 355, 4.9, 1.45, 0, 40, 1.7, 2016, 4100, 'New York, NY', 'David Arogundade', 'Builds AI-powered code intelligence and developer productivity tools used by engineering teams at most Fortune 500 firms.'),
  S('OCTEQ', 'Octeq Digital', 'Technology', 39.2, 290, 3.6, 1.25, 0.9, 33, 0.78, 2009, 6700, 'Chicago, IL', 'Nathan Brooks', 'Commerce media and digital advertising technology connecting retailers with demand-side platforms and audience data.'),
  S('NEURX', 'Neuraflux AI', 'Technology', 214.6, 505, 14, 1.55, 0, 52, 2.1, 2015, 7400, 'Palo Alto, CA', 'Vikram Sethi', 'Operates large-scale AI inference infrastructure and sells model-serving capacity to enterprises and AI application developers.'),
  S('SYNTQ', 'Syntiq Corporation', 'Technology', 158.3, 330, 6.2, 1.5, 0, 48, 2.85, 2014, 3800, 'Cambridge, MA', 'Rachel Eisenberg', 'Machine learning operations platform for model training orchestration, evaluation, and governance in regulated industries.'),
  S('QUBIQ', 'Qubiq Analytics', 'Technology', 67.85, 245, 4.4, 1.4, 0, 44, 0.66, 2017, 2600, 'Denver, CO', 'Tomás Ferreira', 'Decision intelligence software applying causal inference and simulation to supply chain and pricing problems.'),

  // ─── Financials ──────────────────────────────────────────────────────────
  S('MRDN', 'Meridian Financial Group', 'Financials', 83.1, 940, 8.5, 1.05, 2.1, 18, 6.4, 1932, 31000, 'Stamford, CT', 'Alan Pierce-Whitmore', 'Diversified financial services holding company spanning life insurance, retirement solutions, and institutional asset management.'),
  S('AXBK', 'Axiom Bancorp', 'Financials', 47.55, 1600, 7.2, 0.95, 2.8, 14, 3.9, 1889, 58000, 'New York, NY', 'Catherine Doyle', 'National banking corporation providing commercial lending, treasury services, and consumer banking across 2,100 branches.'),
  S('VSTRA', 'Vestra Capital', 'Financials', 26.9, 380, 2.9, 1.1, 1.9, 20, 1.75, 1988, 4200, 'Greenwich, CT', 'Robert Callahan', 'Alternative asset manager focused on private credit, real assets, and liquid strategies with $182 billion under management.'),
  S('GNRY', 'Granary Bancshares', 'Financials', 31.75, 260, 1.8, 0.85, 3.2, 12, 2.05, 1927, 3600, 'Des Moines, IA', 'Walter Jensen', 'Community banking franchise serving agricultural and small-business clients throughout the upper Midwest.'),

  // ─── Healthcare ──────────────────────────────────────────────────────────
  S('HELX', 'Helixion Therapeutics', 'Healthcare', 94.2, 460, 6.8, 1.2, 0.7, 36, 2.05, 1998, 8900, 'Cambridge, MA', 'Dr. Ingrid Salomon', 'Commercial-stage biopharmaceutical company focused on immunology and rare autoimmune diseases with three approved therapies.'),
  S('ZRNX', 'Zernova Bio', 'Healthcare', 18.4, 195, 5.9, 1.6, 0, 65, -0.42, 2012, 940, 'South San Francisco, CA', 'Dr. Leilani Freeman', 'Clinical-stage biotechnology company developing gene-editing therapies for hematologic disorders; lead candidate in Phase 2b.'),
  S('MENDL', 'Mendelis Health', 'Healthcare', 52.65, 610, 4.7, 0.95, 1.4, 22, 2.6, 1975, 19400, 'Minneapolis, MN', 'Gerald Novak', 'Medical device manufacturer specializing in patient monitoring systems, respiratory care equipment, and diagnostic consumables.'),
  S('CRDSP', 'Cardiospan Medical', 'Healthcare', 27.3, 240, 2.6, 1.15, 0, 34, 0.55, 2008, 2100, 'Irvine, CA', 'Dr. Amir Haddad', 'Develops wearable cardiac diagnostics and remote arrhythmia monitoring services for health systems and payers.'),

  // ─── Energy ──────────────────────────────────────────────────────────────
  S('TERRV', 'Terova Energy', 'Energy', 41.85, 1150, 9.4, 1.25, 2.6, 32, 3.1, 1985, 12400, 'Houston, TX', 'Beau Landry', 'Diversified exploration and production company with core positions in the Permian Basin and Gulf of America.'),
  S('PLCN', 'Pelicon Energy', 'Energy', 63.2, 520, 5.2, 1.3, 3.1, 36, 5.4, 1992, 6800, 'Stavanger Operations — Houston, TX', 'Sigrid Halvorsen', 'Offshore drilling contractor operating a fleet of eight ultra-deepwater drillships under long-term contracts.'),
  S('HLXQ', 'Heliqen Power', 'Energy', 15.6, 340, 4.8, 1.5, 0, 55, -0.18, 2010, 1500, 'Golden, CO', 'Maya Delacroix', 'Develops utility-scale solar, storage, and green hydrogen production facilities across North America and Iberia.'),
  S('PETQ', 'Petraquin Midstream Partners', 'Energy', 22.4, 720, 3.9, 0.9, 4.2, 24, 1.35, 1998, 3400, 'Dallas, TX', 'Chuck Beaumont', 'Owns and operates refined product pipelines, terminals, and export facilities across the Gulf Coast corridor.'),
  S('NDRX', 'Netherfield Resources', 'Energy', 34.7, 410, 3.4, 1.2, 1.8, 30, 2.2, 2001, 5200, 'Calgary, AB', 'Grant MacTavish', 'Oil sands and thermal production assets with integrated upgrading capacity and long-life reserves.'),

  // ─── Consumer ────────────────────────────────────────────────────────────
  S('KRAVN', 'Kraven Retail Group', 'Consumer', 28.9, 830, 6.1, 1.2, 1.1, 28, 1.95, 1962, 96000, 'Bentonville, AR', 'Diane Hutchins', 'Operates 1,840 discount variety stores offering groceries, general merchandise, and pharmacy services.'),
  S('DOLCI', 'Dolciva Foods', 'Consumer', 14.25, 410, 2.4, 0.7, 2.4, 16, 1.1, 1946, 8900, 'Pittsburgh, PA', 'Marco Bellisario', 'Packaged foods company producing confectionery, bakery, and snack brands distributed in 40 countries.'),
  S('AURQ', 'Aurique Apparel', 'Consumer', 22.15, 350, 3.3, 1.35, 0.8, 38, 1.4, 1998, 21000, 'Los Angeles, CA', 'Zoë Marchetti', 'Fast-fashion apparel retailer with vertically integrated design-to-shelf cycle and 900 stores across three continents.'),
  S('BASTN', 'Bastion Home Goods', 'Consumer', 36.4, 280, 2.2, 1.05, 1.6, 24, 2.3, 1979, 14300, 'Atlanta, GA', 'Fred McAllister', 'Home improvement and furnishings retailer operating big-box stores and a growing e-commerce platform.'),
  S('VOLTQ', 'Voltique Motors', 'Consumer', 88.95, 1050, 16, 1.75, 0, 58, 1.85, 2003, 68000, 'Fremont, CA', 'Adrian Kowalczyk', 'Designs and manufactures electric vehicles, energy storage systems, and charging infrastructure across North America, Europe, and Asia.'),
  S('DRVML', 'Drivemile Mobility', 'Consumer', 12.4, 310, 3.4, 1.5, 0, 50, -0.35, 2011, 5600, 'San Francisco, CA', 'Nia Campbell', 'Operates rideshare and micromobility marketplaces in 220 metropolitan areas with a growing advertising business.'),
  S('HYDQ', 'Hydroq Motors', 'Consumer', 9.75, 220, 2.9, 1.6, 0, 60, -0.62, 2015, 4100, 'Torrance, CA', 'Kenji Watanabe', 'Develops hydrogen fuel-cell Class 8 trucks and refueling infrastructure for regional freight corridors.'),

  // ─── Industrials ─────────────────────────────────────────────────────────
  S('ATKR', 'Atlascore Industries', 'Industrials', 118.5, 430, 4.6, 1.1, 1.2, 26, 6.8, 1908, 27000, 'Milwaukee, WI', 'Henrik Dahl', 'Diversified industrial manufacturer producing flow-control equipment, precision bearings, and industrial automation systems.'),
  S('VELR', 'Velaero Aerospace', 'Industrials', 74.15, 370, 3.8, 1.3, 0.9, 30, 2.9, 1969, 18500, 'El Segundo, CA', 'General Pat Rourke (Ret.)', 'Defense contractor delivering satellite systems, missile guidance, and space launch services to government and commercial customers.'),
  S('IRWQ', 'Ironworks Manufacturing', 'Industrials', 19.8, 190, 1.9, 1.15, 1.4, 27, 1.15, 1935, 6200, 'Cleveland, OH', 'Sal Moretti', 'Specialty steel fabrication and industrial components for construction, energy transmission, and rail markets.'),
  S('GRXN', 'Gearon Dynamics', 'Industrials', 44.7, 260, 2.7, 1.25, 0.8, 29, 2.85, 2002, 7300, 'Pittsburgh, PA', 'Dr. Sofia Petrov', 'Designs warehouse robotics, autonomous material-handling systems, and industrial machine-vision platforms.'),

  // ─── Communication ───────────────────────────────────────────────────────
  S('STRMQ', 'Streamquill Media', 'Communication', 31.2, 780, 5.8, 1.2, 0, 30, 1.55, 2007, 8400, 'New York, NY', 'Omar Ellison', 'Subscription streaming service with 68 million households and a growing slate of live sports rights.'),
  S('WVLN', 'Wavelink Communications', 'Communication', 24.85, 950, 4.4, 0.9, 1.8, 20, 1.7, 1983, 23000, 'Denver, CO', 'Miguel Santana', 'Telecom infrastructure operator managing fiber backbone, tower assets, and wholesale bandwidth for carriers.'),
  S('PXLQ', 'Pixelqon Studios', 'Communication', 57.6, 210, 3.1, 1.45, 0.5, 42, 2.2, 1994, 3900, 'Bellevue, WA', 'Kim Ha-eun', 'Interactive entertainment studio behind the Everforge franchise and a portfolio of live-service titles.'),

  // ─── Utilities ───────────────────────────────────────────────────────────
  S('GRTD', 'Gridstone Utilities', 'Utilities', 54.3, 690, 3.2, 0.6, 3.4, 15, 3.05, 1901, 9800, 'Columbus, OH', 'Barbara Nielsen', 'Regulated electric utility serving 4.1 million customer accounts with an accelerating grid-modernization program.'),
  S('AQFR', 'Aquifer Resources', 'Utilities', 38.65, 340, 2.1, 0.75, 2.9, 18, 1.9, 1926, 4200, 'Phoenix, AZ', 'Carlos Ibarra', 'Water utility and infrastructure services provider operating across the arid Southwest.'),

  // ─── ETFs ────────────────────────────────────────────────────────────────
  E('MCOM', 'Meridian Composite ETF', 'Technology', 487.2, 42, 14, 'Seeks to track the MRX Composite Index, a market-cap-weighted benchmark of Meridian-listed operating companies.'),
  E('MTEK', 'Meridian Technology ETF', 'Technology', 214.85, 18, 22, 'Seeks to track the MRX Technology Sector Index covering semiconductors, software, and AI infrastructure.'),
  E('MFIN', 'Meridian Financial ETF', 'Financials', 96.4, 9, 17, 'Seeks to track the MRX Financials Sector Index of banks, insurers, and asset managers listed on Meridian.'),
  E('MHLT', 'Meridian Healthcare ETF', 'Healthcare', 88.15, 7, 19, 'Seeks to track the MRX Healthcare Sector Index of biopharmaceutical, device, and diagnostics issuers.'),
  E('MNRG', 'Meridian Energy ETF', 'Energy', 74.3, 6, 24, 'Seeks to track the MRX Energy Sector Index covering upstream, midstream, and renewables issuers.'),
  E('MCSM', 'Meridian Consumer ETF', 'Consumer', 132.6, 8, 18, 'Seeks to track the MRX Consumer Sector Index of retail, food, apparel, and mobility issuers.'),
]

export const BY_SYMBOL: Map<string, Instrument> = new Map(INSTRUMENTS.map((i) => [i.symbol, i]))

export const SECTOR_TARGET_LEVELS: Partial<Record<Sector, number>> = {
  Technology: 3180.45,
  Financials: 1745.6,
  Healthcare: 2130.2,
  Energy: 980.35,
  Consumer: 2450.8,
  Industrials: 2610.7,
  Communication: 1470.25,
  Utilities: 1120.6,
}

export const COMPOSITE_TARGET_LEVEL = 6214.3

export function sectorOf(symbol: string): Sector | null {
  return BY_SYMBOL.get(symbol)?.sector ?? null
}
