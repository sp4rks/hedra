import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
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

/** Polls the example route until the child accepts a connection or the deadline passes. */
async function waitForApp(port: number): Promise<Response> {
  const deadline = Date.now() + 5000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${port}/`)
    } catch (error) {
      lastError = error
      await Bun.sleep(50)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('server did not accept a connection')
}

test('the process entrypoint serves the example route', async () => {
  const port = await freePort()
  const proc = Bun.spawn(['bun', 'examples/01-helloworld.ts'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HEDRA_SERVER_LISTEN_IP: '127.0.0.1',
      HEDRA_SERVER_LISTEN_PORT: String(port),
      HEDRA_SERVER_SILENT_STARTUP: 'true',
      HEDRA_SERVER_LOG_LEVEL: 'silent',
    },
    stdout: 'ignore',
    stderr: 'pipe',
  })

  try {
    const response = await waitForApp(port)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Hello Hedra!')

    const acceptsOtherAddress = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: '127.0.0.2' })

      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })

    expect(acceptsOtherAddress).toBe(false)
  } finally {
    proc.kill()
    await proc.exited
  }
})

test('invalid configuration exits before listening or opening SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-invalid-startup-'))
  const database = join(dir, 'db.sqlite')
  const port = await freePort()
  const proc = Bun.spawn(['bun', 'examples/01-helloworld.ts'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HEDRA_DEPLOYMENT_DOMAIN: 'not a domain',
      HEDRA_SERVER_LISTEN_IP: '127.0.0.1',
      HEDRA_SERVER_LISTEN_PORT: String(port),
      HEDRA_SERVER_SILENT_STARTUP: 'true',
      HEDRA_SERVER_LOG_LEVEL: 'silent',
      HEDRA_SQLITE_PATH: database,
    },
    stdout: 'ignore',
    stderr: 'pipe',
  })

  const deadline = Date.now() + 3000
  const served = (async () => {
    while (proc.exitCode === null && Date.now() < deadline) {
      const connected = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(100) }).then(
        () => true,
        () => false,
      )

      if (connected) return true
      await Bun.sleep(10)
    }

    return false
  })()

  try {
    const exitCode = await Promise.race([proc.exited, Bun.sleep(3000).then(() => -1)])

    if (exitCode === -1) proc.kill()

    const error = await new Response(proc.stderr).text()

    expect(exitCode).toBe(1)
    expect(await served).toBe(false)
    expect(error).toContain('HEDRA_DEPLOYMENT_DOMAIN')
    expect(existsSync(database)).toBe(false)
  } finally {
    proc.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
