// MRX market data relay — fans out engine broadcasts to Socket.IO clients.
// The engine (inside Next.js) POSTs batches here; clients subscribe via rooms.

import { createServer } from 'http'
import { Server } from 'socket.io'
import { writeFileSync, readFileSync, existsSync } from 'fs'

const PORT = 3003
const NEXT_PORT = process.env.NEXT_PORT || 3000

const httpServer = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/internal/broadcast') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        const { messages } = JSON.parse(body)
        for (const m of messages ?? []) {
          if (m.room === 'market') {
            io.to('market').emit(m.event, m.data)
          } else if (m.room?.startsWith('account:')) {
            io.to(m.room).emit(m.event, m.data)
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, clients: io.engine.clientsCount }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ ok: false }))
      }
    })
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('MRX market data relay\n')
})

const io = new Server(httpServer, {
  // Default '/socket.io' path. Caddy routes by the XTransformPort query param,
  // so the path is irrelevant to the proxy — and keeping engine.io scoped to
  // '/socket.io' prevents it from intercepting POST /internal/broadcast.
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 2e6,
})

io.on('connection', (socket) => {
  socket.join('market')

  socket.on('subscribe-account', async (data: { api_key?: string }) => {
    try {
      const key = data?.api_key
      if (!key || typeof key !== 'string') return
      const res = await fetch(`http://127.0.0.1:${NEXT_PORT}/api/internal/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key }),
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return
      const json = await res.json()
      if (json?.account_id) {
        socket.join('account:' + json.account_id)
        socket.emit('account-subscribed', { account_id: json.account_id })
      }
    } catch {
      // ignore
    }
  })

  socket.on('unsubscribe-account', () => {
    const rooms = [...socket.rooms].filter((r) => r.startsWith('account:'))
    for (const r of rooms) socket.leave(r)
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

httpServer.listen(PORT, () => {
  console.log(`MRX market data relay running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})

// suppress unused import warnings
void writeFileSync
void readFileSync
void existsSync
