// Next.js 16 proxy (middleware): CORS headers on every matched request.

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import proxy, { config } from '@/proxy'

describe('proxy', () => {
  it('stamps CORS + exchange headers on API responses', () => {
    const req = new NextRequest('http://localhost:3000/api/v1/market/quote?symbols=QNTM')
    const res = proxy(req)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS')
    expect(res.headers.get('access-control-allow-headers')).toContain('X-MRX-Key')
    expect(res.headers.get('access-control-allow-headers')).toContain('X-Operator-Key')
    expect(res.headers.get('x-mrx-exchange')).toBe('Meridian Exchange (MRX)')
  })

  it('declares its matcher: all v1 + internal routes', () => {
    expect(config.matcher).toEqual(['/api/v1/:path*', '/api/internal/:path*'])
  })
})
