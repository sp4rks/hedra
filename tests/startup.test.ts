import { expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { join } from 'node:path'

const projectRoot = join(import.meta.dir, '..')

/** Reserves an ephemeral local port, then releases it for the child process. */
function freePort(): Promise<number> {
  const server = createServer()

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('failed to reserve a port'))
        return
      }

      const { port } = address
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

/** Polls GET /health until the child accepts a connection or the deadline passes. */
async function waitForHealth(port: number): Promise<Response> {
  const deadline = Date.now() + 5000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${port}/health`)
    } catch (error) {
      lastError = error
      await Bun.sleep(50)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('server did not accept a connection')
}

test('the process entrypoint serves GET /health', async () => {
  const port = await freePort()
  const proc = Bun.spawn(['bun', 'src/hedra.ts'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HEDRA_SERVER_PORT: String(port),
      HEDRA_SERVER_SILENT_STARTUP: 'true',
      HEDRA_SERVER_LOG_LEVEL: 'silent',
    },
    stdout: 'ignore',
    stderr: 'pipe',
  })

  try {
    const response = await waitForHealth(port)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  } finally {
    proc.kill()
    await proc.exited
  }
})

test('the process entrypoint exits when configuration is invalid', async () => {
  const proc = Bun.spawn(['bun', 'src/hedra.ts'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HEDRA_DEPLOYMENT_DOMAIN: 'not a domain',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
      HEDRA_SERVER_LOG_LEVEL: 'silent',
    },
    stdout: 'ignore',
    stderr: 'ignore',
  })

  expect(await proc.exited).toBe(1)
})
