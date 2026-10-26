import { defineConfig, type Plugin } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

function localCloudflareWorkerPlugin(): Plugin {
  let readyPromise: Promise<{ db: any; api: any; secret: string; playerId: string; freightNs: any }> | null = null

  async function ensureRuntime() {
    if (!readyPromise) {
      readyPromise = (async () => {
        const { Miniflare, convertV4MiniflareOptions } = await import('miniflare')
        const apiMod = await import('./server/api')
        const { Freight } = await import('./server/freight')
        const { issueSession } = await import('./server/auth')
        const { streetAccount } = await import('./server/street')
        const mf = new Miniflare(
          convertV4MiniflareOptions({
            workers: [
              {
                name: 'hoverghini-dev',
                modules: true,
                script: 'export default { fetch() { return new Response("ok") } }',
                compatibilityDate: '2026-10-01',
                d1Databases: ['DB'],
              },
            ],
          }),
        )
        const db = (await mf.getD1Database('DB')) as any
        for (const name of readdirSync('server/migrations').sort()) {
          const sql = readFileSync('server/migrations/' + name, 'utf8').replace(/^--.*$/gm, '')
          const stmts = sql
            .split(/;\s*(?=CREATE|INSERT INTO (?:property_catalog_clock|freight_fund|street_fund)|$)/)
            .map((s) => s.trim())
            .filter(Boolean)
          for (const q of stmts) await db.prepare(q).run()
        }
        const session = await issueSession(db, 'aistudio-preview-driver', 'google')
        await streetAccount(db, session.playerId)
        await db
          .prepare('UPDATE players SET display_name = ? WHERE id = ?')
          .bind('Slade', session.playerId)
          .run()

        const freightActors = new Map<string, any>()
        const freightNs = {
          idFromName: (name: string) => name,
          get: (id: string) => {
            if (!freightActors.has(id)) {
              const store = new Map<string, any>()
              const ctx = {
                blockConcurrencyWhile: <T>(fn: () => Promise<T>) => fn(),
                storage: {
                  get: async (k: string) => store.get(k),
                  put: async (k: string, v: any) => {
                    store.set(k, v)
                  },
                  setAlarm: async () => {},
                },
              }
              freightActors.set(id, new Freight(ctx as any, { DB: db } as any))
            }
            return freightActors.get(id)
          },
        }
        return { db, api: apiMod.default, secret: session.secret, playerId: session.playerId, freightNs }
      })()
    }
    return readyPromise
  }

  function encodeWsTextFrame(text: string): Buffer {
    const payload = Buffer.from(text, 'utf8')
    const len = payload.length
    if (len < 126) {
      const header = Buffer.from([0x81, len])
      return Buffer.concat([header, payload])
    }
    const header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(len, 2)
    return Buffer.concat([header, payload])
  }

  return {
    name: 'hoverghini-local-worker',
    configureServer(server) {
      server.httpServer?.on('upgrade', async (req: IncomingMessage, socket: Duplex) => {
        if (!req.url?.startsWith('/api/multiplayer/socket')) return
        const key = req.headers['sec-websocket-key']
        if (typeof key !== 'string') return
        const { playerId } = await ensureRuntime()
        const accept = createHash('sha1')
          .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
          .digest('base64')
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        )
        socket.write(encodeWsTextFrame(JSON.stringify({ type: 'welcome', id: playerId, epoch: 1 })))
        const heartbeat = setInterval(() => {
          if (socket.destroyed) {
            clearInterval(heartbeat)
            return
          }
          socket.write(encodeWsTextFrame(JSON.stringify({ type: 'ack', t: Date.now() })))
        }, 3000)
        socket.on('data', (chunk: Buffer) => {
          if (chunk.length > 0 && (chunk[0] & 0x0f) === 0x8) {
            clearInterval(heartbeat)
            socket.end()
          } else if (!socket.destroyed) {
            socket.write(encodeWsTextFrame(JSON.stringify({ type: 'ack', t: Date.now() })))
          }
        })
        socket.on('close', () => clearInterval(heartbeat))
        socket.on('error', () => clearInterval(heartbeat))
      })

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const { db, api, secret, freightNs } = await ensureRuntime()
          const host = req.headers.host || 'localhost:3000'
          const origin = `https://${host}`
          if (req.url === '/api/multiplayer/status') {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ enabled: true }))
            return
          }
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          const bodyBuf = chunks.length ? Buffer.concat(chunks) : undefined
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v)) headers.set(k, v.join(', '))
            else if (typeof v === 'string') headers.set(k, v)
          }
          const existingCookie = headers.get('cookie') ?? ''
          if (!existingCookie.includes('__Host-hg_session=')) {
            headers.set('cookie', `${existingCookie ? existingCookie + '; ' : ''}__Host-hg_session=${secret}`)
          }
          headers.set('origin', origin)
          const cfReq = new Request(origin + req.url, {
            method: req.method || 'GET',
            headers,
            body: req.method && ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : bodyBuf,
          })
          const env = {
            DB: db,
            FREIGHT: freightNs,
            APP_ORIGIN: origin,
            ALLOWED_ORIGIN: origin,
            BACKEND_ENABLED: 'true',
            ECONOMY_ENABLED: 'true',
            CREWS_ENABLED: 'true',
            PROPERTIES_ENABLED: 'true',
            MULTIPLAYER_ENABLED: 'true',
            GOOGLE_CLIENT_ID: 'preview-google-client',
            GOOGLE_CLIENT_SECRET: 'preview-google-secret',
          }
          const cfRes = await api.fetch(cfReq, env)
          res.statusCode = cfRes.status
          cfRes.headers.forEach((value: string, key: string) => {
            if (key.toLowerCase() !== 'content-encoding') res.setHeader(key, value)
          })
          const outBuf = Buffer.from(await cfRes.arrayBuffer())
          res.end(outBuf)
        } catch (err) {
          console.error('Local worker API error:', err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Local worker error' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [localCloudflareWorkerPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
})

