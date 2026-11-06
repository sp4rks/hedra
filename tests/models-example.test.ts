import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('models example supports the full controller method lifecycle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-example-'))
  const script = `
    import assert from 'node:assert/strict'
    import hedra, { CarModel, cars } from './examples/02-models.ts'

    hedra.post('/test/cars', async context => context.json(await cars.controller.create(context, cars, {
      make: 'Toyota', model: 'Corolla', year: 2024,
    })))
    hedra.get('/test/cars', async context => context.json(await cars.controller.list(context, cars, 'http://localhost/test/cars', {
      filter: { make: 'Toyota' },
    })))
    hedra.get('/test/cars/:id', async context => context.json(await cars.controller.id(context, cars, context.req.param('id'))))
    hedra.patch('/test/cars/:id', async context => context.json(await cars.controller.update(context, cars, {
      model: 'Yaris', year: 2026,
    }, context.req.param('id'))))
    hedra.delete('/test/cars/:id', async context => {
      await cars.controller.delete(context, cars, context.req.param('id'))
      return context.body(null, 204)
    })

    try {
      assert.deepEqual((await (await hedra.request('/test/cars')).json()).data, [])
      const car = (await (await hedra.request('/test/cars', { method: 'POST' })).json()).data
      assert.deepEqual(CarModel.parse(car), car)
      assert.deepEqual((await (await hedra.request('/test/cars/' + car.id)).json()).data, car)
      assert.deepEqual((await (await hedra.request('/test/cars')).json()).data, [car])
      const updated = (await (await hedra.request('/test/cars/' + car.id, { method: 'PATCH' })).json()).data
      assert.deepEqual(updated, { ...car, model: 'Yaris', year: 2026, updatedAt: updated.updatedAt })
      assert.equal((await hedra.request('/test/cars/' + car.id, { method: 'DELETE' })).status, 204)
      assert.deepEqual((await (await hedra.request('/test/cars')).json()).data, [])
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
