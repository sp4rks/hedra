import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('models example exposes its car model through generated routes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-example-'))
  const script = `
    import assert from 'node:assert/strict'
    import hedra, { CarModel, cars } from './examples/02-models.ts'

    try {
      assert.equal(cars.endpoint, '/cars')
      const input = { make: 'Toyota', model: 'Corolla', year: 2024 }
      const response = await hedra.request('/cars', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      })
      assert.equal(response.status, 201)
      const car = (await response.json()).data
      assert.deepEqual(CarModel.parse(car), car)
      assert.deepEqual({ make: car.make, model: car.model, year: car.year }, input)
      assert.deepEqual((await (await hedra.request('/cars/' + car.id)).json()).data, car)
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
