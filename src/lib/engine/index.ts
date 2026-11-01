// Engine singleton accessor.

import { MarketEngine } from './engine'

const g = globalThis as unknown as { __mrxEngine?: MarketEngine }

export function getEngine(): MarketEngine {
  if (!g.__mrxEngine) {
    const e = new MarketEngine()
    g.__mrxEngine = e
    e.ready = e.init()
      .then(async () => {
        // Wire DB-persistence hooks at boot (deferred import avoids a module cycle)
        const { wireEngineHooks } = await import('./accounts')
        wireEngineHooks(e)
        return e
      })
      .catch((err) => {
        console.error('[MRX] engine init failed:', err)
        if (g.__mrxEngine === e) delete g.__mrxEngine // allow a clean retry on next request
        throw err
      })
  }
  return g.__mrxEngine
}

export async function getEngineReady(): Promise<MarketEngine> {
  const e = getEngine()
  await e.ready
  return e
}

export type { Quote, Level, TapeTrade } from './engine'
