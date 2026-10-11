import http from 'node:http'

import { MockError, mockRequest } from './src/mock'

const store = new Map<string, string>()

// Minimal localStorage shim so the existing mock backend logic can run in Node.
const localStorageLike: Storage = {
  length: 0,
  clear() {
    store.clear()
    this.length = 0
  },
  getItem(key: string) {
    return store.has(key) ? store.get(key) ?? null : null
  },
  key(index: number) {
    return Array.from(store.keys())[index] ?? null
  },
  removeItem(key: string) {
    const had = store.delete(key)
    this.length = store.size
    return had
  },
  setItem(key: string, value: string) {
    store.set(key, value)
    this.length = store.size
  },
  [Symbol.iterator]() {
    return store.entries()[Symbol.iterator]()
  },
} as Storage

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageLike,
  configurable: true,
})

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })

    req.on('error', reject)
  })
}

const PORT = Number(process.env.PORT ?? '8000')

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Merchant-Id',
    })
    res.end()
    return
  }

  try {
    const url = new URL(req.url ?? '/', 'http://localhost:8000')
    const method = req.method ?? 'GET'
    const merchantId = req.headers['x-merchant-id'] ?? null
    const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(req)
    const normalizedPath = url.pathname.startsWith('/api') ? url.pathname.slice('/api'.length) : url.pathname

    const payload = await mockRequest(method, `${normalizedPath}${url.search}`, body, merchantId)

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Merchant-Id',
    })
    res.end(JSON.stringify(payload))
  } catch (error) {
    if (error instanceof MockError) {
      res.writeHead(error.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify({ error: { code: error.code, message: error.message } }))
      return
    }

    const message = error instanceof Error ? error.message : 'Internal server error'
    res.writeHead(500, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message } }))
  }
})

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.warn(`Backend API port ${PORT} is already in use; assuming an existing local backend is running.`)
    return
  }

  console.error('Backend API server error:', error)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend API listening on http://localhost:${PORT}`)
})
