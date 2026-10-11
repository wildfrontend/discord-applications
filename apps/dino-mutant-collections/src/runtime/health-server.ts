import { createServer, type Server } from 'node:http'

type HealthStatus = 'starting' | 'ready' | 'stopping'

export interface HealthServer {
  close(): Promise<void>
  setStatus(status: HealthStatus): void
}

export async function startHealthServer(): Promise<HealthServer> {
  const configuredPort = process.env.PORT?.trim()
  if (!configuredPort) {
    return {
      close: async () => undefined,
      setStatus: () => undefined,
    }
  }

  const port = Number(configuredPort)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT 必須是 1 到 65535 之間的整數。')
  }

  let status: HealthStatus = 'starting'
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/healthz') {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'not_found' }))
      return
    }

    response.writeHead(status === 'stopping' ? 503 : 200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    })
    response.end(JSON.stringify({ status }))
  })

  await listen(server, port)
  console.log(`[health] Listening on 0.0.0.0:${port}/healthz`)

  return {
    close: () => close(server),
    setStatus(nextStatus) {
      status = nextStatus
    },
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
