import {
  type CallToolResult,
  Client,
  StreamableHTTPClientTransport,
  type Tool,
} from '@modelcontextprotocol/client'
import { wikiToolNames } from './config.js'

export interface WikiSession {
  tools: Tool[]
  instructions: string
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>
  close(): Promise<void>
}

export async function connectWiki(
  url: string,
  signal: AbortSignal,
): Promise<WikiSession> {
  const client = new Client({
    name: 'dino-mutant-discord-consultation',
    version: '1.0.0',
  })
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
  })
  try {
    await client.connect(transport, { signal, timeout: 20_000 })
    const { tools } = await client.listTools({}, { signal, timeout: 20_000 })
    // This feature only authorizes the Wiki's four inspected query/calculation tools.
    const allowed = tools.filter((tool) =>
      wikiToolNames.some((name) => name === tool.name),
    )
    if (!allowed.length)
      throw new Error('Wiki has no supported consultation tools')
    return {
      tools: allowed,
      instructions: client.getInstructions() ?? '',
      async callTool(name, args) {
        if (!allowed.some((tool) => tool.name === name))
          throw new Error('Unsupported Wiki tool')
        return client.callTool(
          { name, arguments: args },
          { signal, timeout: 20_000 },
        )
      },
      async close() {
        // A stateless server may not support DELETE; always close the client too.
        await transport.terminateSession().catch(() => {})
        await client.close()
      },
    }
  } catch (error) {
    await client.close().catch(() => {})
    throw error
  }
}
