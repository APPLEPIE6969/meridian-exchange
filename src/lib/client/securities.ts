'use client'

// Client-safe re-export of the instrument universe (pure data, no server deps).
import { BY_SYMBOL, INSTRUMENTS } from '@/lib/engine/universe'

export const BY_SYMBOL_CLIENT = BY_SYMBOL
export const INSTRUMENTS_CLIENT = INSTRUMENTS
export type ClientInstrument = (typeof INSTRUMENTS)[number]
