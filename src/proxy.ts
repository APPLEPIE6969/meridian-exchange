import { NextRequest, NextResponse } from 'next/server'

// CORS headers for the trading API (used by external AI agents and tools).
// Next.js 16 proxy convention (replaces middleware.ts).
export default function proxy(req: NextRequest) {
  const res = NextResponse.next()
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MRX-Key, X-API-Key, X-Operator-Key')
  res.headers.set('X-MRX-Exchange', 'Meridian Exchange (MRX)')
  return res
}

export const config = {
  matcher: ['/api/v1/:path*', '/api/internal/:path*'],
}
