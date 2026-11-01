import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('models example supports the full collection method lifecycle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-example-'))
  const script = `
    import assert from 'node:assert/strict'
    import hedra, { CarModel, cars } from './examples/02-models.ts'

    try {
      assert.deepEqual(cars.get(), [])
      const car = { make: 'Toyota', model: 'Corolla', year: 2024 }
      assert.deepEqual(CarModel.parse(car), car)
      assert.deepEqual(cars.post(car), car)
      assert.deepEqual(cars.get({ make: 'Toyota' }), [car])
      assert.equal(cars.put({ make: 'Toyota' }, { make: 'Toyota', model: 'Yaris', year: 2025 }), 1)
      assert.equal(cars.patch({ model: 'Yaris' }, { year: 2026 }), 1)
      assert.deepEqual(cars.get(), [{ make: 'Toyota', model: 'Yaris', year: 2026 }])
      assert.equal(cars.delete({ make: 'Toyota' }), 1)
      assert.deepEqual(cars.get(), [])
    } finally {
      hedra.close()
    }
  `
  const proc = Bun.spawn([process.execPath, '-e', script], {
    cwd: join(import.meta.dir, '..'),
    env: {
      HEDRA_SQLITE_PATH: join(dir, 'db.sqlite'),
      HEDRA_SERVER_SILENT_STARTUP: 'true',
      HEDRA_SERVER_LOG_LEVEL: 'silent',
    },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 5000,
  })

  try {
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: '', stderr: '' })
  } finally {
    proc.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
