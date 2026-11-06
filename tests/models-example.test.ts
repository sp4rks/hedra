import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('models example supports the full controller method lifecycle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-example-'))
  const script = `
    import assert from 'node:assert/strict'
    import hedra, { CarModel, cars } from './examples/02-models.ts'

    try {
      assert.deepEqual(await cars.controller.list(), [])
      const car = await cars.controller.create({ make: 'Toyota', model: 'Corolla', year: 2024 })
      assert.deepEqual(CarModel.parse(car), car)
      assert.deepEqual(await cars.controller.get(car.id), car)
      assert.deepEqual(await cars.controller.list({ make: 'Toyota' }), [car])
      assert.deepEqual(await cars.controller.replace(car.id, { make: 'Toyota', model: 'Yaris', year: 2025 }),
        { id: car.id, make: 'Toyota', model: 'Yaris', year: 2025 })
      assert.deepEqual(await cars.controller.update(car.id, { year: 2026 }),
        { id: car.id, make: 'Toyota', model: 'Yaris', year: 2026 })
      assert.equal(await cars.controller.delete(car.id), true)
      assert.deepEqual(await cars.controller.list(), [])
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
