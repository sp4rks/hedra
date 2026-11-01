import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import { Collection, Hedra } from '#hedra.ts'

const quiet = {
  HEDRA_SERVER_SILENT_STARTUP: 'true',
  HEDRA_SERVER_LOG_LEVEL: 'silent',
  HEDRA_SQLITE_PATH: ':memory:',
}

test('POST stores and returns the parsed model', () => {
  const app = new Hedra(quiet)
  const cars = new Collection('cars', z.object({ make: z.string().trim(), year: z.number().int().default(2020) }))

  app.register(cars)

  try {
    expect(cars.post({ make: ' Toyota ' })).toEqual({ make: 'Toyota', year: 2020 })
    expect(cars.get()).toEqual([{ make: 'Toyota', year: 2020 }])
  } finally {
    app.close()
  }
})

test('GET requires every supplied filter field to match', () => {
  const app = new Hedra(quiet)
  const cars = new Collection('cars', z.object({ make: z.string(), year: z.number().int() }))

  app.register(cars)

  try {
    cars.post({ make: 'Toyota', year: 2020 })
    cars.post({ make: 'Toyota', year: 2021 })
    cars.post({ make: 'Honda', year: 2020 })
    expect(cars.get({ make: 'Toyota', year: 2020 })).toEqual([{ make: 'Toyota', year: 2020 }])
    expect(cars.get({ make: 'Honda', year: 2021 })).toEqual([])
  } finally {
    app.close()
  }
})

test('PUT replaces every match with the full parsed model', () => {
  const app = new Hedra(quiet)
  const cars = new Collection(
    'cars',
    z.object({
      make: z.string(),
      year: z.number().int(),
      note: z.string().optional(),
      status: z.string().default('available'),
    }),
  )

  app.register(cars)

  try {
    cars.post({ make: 'Toyota', year: 2020, note: 'first', status: 'sold' })
    cars.post({ make: 'Toyota', year: 2021, note: 'second' })
    cars.post({ make: 'Honda', year: 2022 })
    expect(cars.put({ make: 'Toyota' }, { make: 'Lexus', year: 2024 })).toBe(2)
    expect(cars.get()).toEqual([
      { make: 'Lexus', year: 2024, status: 'available' },
      { make: 'Lexus', year: 2024, status: 'available' },
      { make: 'Honda', year: 2022, status: 'available' },
    ])
  } finally {
    app.close()
  }
})

test('PATCH rolls back every match when a later result fails validation', () => {
  const app = new Hedra(quiet)
  const ranges = new Collection(
    'ranges',
    z.object({ group: z.string(), min: z.number(), max: z.number() }).refine((range) => range.min <= range.max),
  )

  app.register(ranges)

  try {
    ranges.post({ group: 'a', min: 1, max: 10 })
    ranges.post({ group: 'a', min: 8, max: 10 })
    expect(() => ranges.patch({ group: 'a' }, { max: 5 })).toThrow(z.ZodError)
    expect(ranges.get()).toEqual([
      { group: 'a', min: 1, max: 10 },
      { group: 'a', min: 8, max: 10 },
    ])
  } finally {
    app.close()
  }
})

test('DELETE removes every match and reports the count', () => {
  const app = new Hedra(quiet)
  const cars = new Collection('cars', z.object({ make: z.string(), year: z.number() }))

  app.register(cars)

  try {
    cars.post({ make: 'Toyota', year: 2020 })
    cars.post({ make: 'Honda', year: 2021 })
    cars.post({ make: 'Toyota', year: 2020 })
    expect(cars.delete({ make: 'Toyota' })).toBe(2)
    expect(cars.get()).toEqual([{ make: 'Honda', year: 2021 }])
    expect(cars.delete({ make: 'Toyota' })).toBe(0)
  } finally {
    app.close()
  }
})

test('Non-JSON model output is rejected before persistence', () => {
  const app = new Hedra(quiet)
  const items = new Collection('items', z.object({ value: z.unknown() }))

  app.register(items)
  const cycle: { self?: unknown } = {}

  cycle.self = cycle
  const symbolKey = { [Symbol('key')]: 'value' }
  const sparse = Array(2)

  sparse[1] = 'value'

  try {
    for (const value of [undefined, Infinity, 1n, new Date('2020-01-01'), new Map(), cycle, symbolKey, sparse]) {
      expect(() => items.post({ value })).toThrow()
      expect(items.get()).toEqual([])
    }
  } finally {
    app.close()
  }
})

test('Unstable model transformations are rejected before persistence', () => {
  const app = new Hedra(quiet)
  const changing = new Collection('changing', z.object({ value: z.number().transform((value) => value + 1) }))
  const converted = new Collection('converted', z.object({ value: z.string().transform(Number) }))

  app.register(changing)
  app.register(converted)

  try {
    expect(() => changing.post({ value: 1 })).toThrow()
    expect(() => converted.post({ value: '1' })).toThrow()
    expect(changing.get()).toEqual([])
    expect(converted.get()).toEqual([])
  } finally {
    app.close()
  }
})

test('Mutating model transformations cannot change records across parses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-models-'))
  const path = join(dir, 'db.sqlite')
  const originalModel = z.object({ group: z.string(), value: z.unknown() })
  const mutatingModel = z.object({
    group: z.string(),
    value: z.unknown().transform((value) => {
      const item = value as { count: number }

      item.count += 1

      return item
    }),
  })
  const first = new Hedra({ ...quiet, HEDRA_SQLITE_PATH: path })
  const original = new Collection('items', originalModel)

  try {
    first.register(original)
    original.post({ group: 'a', value: { count: 0 } })
    first.close()

    const second = new Hedra({ ...quiet, HEDRA_SQLITE_PATH: path })
    const mutating = new Collection('items', mutatingModel)

    second.register(mutating)
    try {
      expect(() => mutating.post({ group: 'b', value: { count: 0 } })).toThrow('stable JSON')
      expect(() => mutating.get()).toThrow('stable JSON')
      expect(() => mutating.put({ group: 'a' }, { group: 'a', value: { count: 0 } })).toThrow('stable JSON')
      expect(() => mutating.patch({ group: 'a' }, { group: 'b' })).toThrow('stable JSON')
    } finally {
      second.close()
    }

    const third = new Hedra({ ...quiet, HEDRA_SQLITE_PATH: path })
    const reopened = new Collection('items', originalModel)

    third.register(reopened)
    try {
      expect(reopened.get()).toEqual([{ group: 'a', value: { count: 0 } }])
    } finally {
      third.close()
    }
  } finally {
    first.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PATCH preserves unspecified fields and replaces nested values', () => {
  const app = new Hedra(quiet)
  const cars = new Collection(
    'cars',
    z.object({
      make: z.string(),
      status: z.string().default('available'),
      engine: z.object({ fuel: z.string(), cylinders: z.number().optional() }),
      tags: z.array(z.string()),
      note: z.string().nullable(),
    }),
  )

  app.register(cars)

  try {
    cars.post({ make: 'Toyota', status: 'sold', engine: { fuel: 'petrol', cylinders: 4 }, tags: ['old'], note: 'old' })
    expect(cars.patch({ make: 'Toyota' }, { engine: { fuel: 'electric' }, tags: ['new'], note: null })).toBe(1)
    expect(cars.patch({ make: 'Toyota' }, {})).toBe(1)
    expect(cars.get()).toEqual([
      { make: 'Toyota', status: 'sold', engine: { fuel: 'electric' }, tags: ['new'], note: null },
    ])
  } finally {
    app.close()
  }
})

test('Invalid filters fail without changing records', () => {
  const app = new Hedra(quiet)
  const cars = new Collection('cars', z.object({ make: z.string(), year: z.number() }))

  app.register(cars)

  try {
    cars.post({ make: 'Toyota', year: 2020 })

    for (const filter of [
      undefined,
      {},
      [],
      { make: undefined },
      { year: Infinity },
      { make: ['Toyota'] },
      { missing: 'x' },
    ]) {
      expect(() => cars.put(filter as never, { make: 'Honda', year: 2021 })).toThrow()
      expect(() => cars.patch(filter as never, { year: 2021 })).toThrow()
      expect(() => cars.delete(filter as never)).toThrow()
    }
    expect(() => cars.get({ constructor: 'x' } as never)).toThrow('Invalid collection filter field: constructor')
    expect(() => cars.get(JSON.parse('{"__proto__":"x"}'))).toThrow('Invalid collection filter field: __proto__')
    // @ts-expect-error The model's year filter must be numeric.
    expect(() => cars.get({ year: '2020' })).toThrow()
    expect(cars.get()).toEqual([{ make: 'Toyota', year: 2020 }])
  } finally {
    app.close()
  }
})

test('Filters preserve scalar types and explicit null', () => {
  const app = new Hedra(quiet)
  const items = new Collection(
    'items',
    z.object({
      label: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    }),
  )

  app.register(items)

  try {
    items.post({ label: 'number', value: 1 })
    items.post({ label: 'string', value: '1' })
    items.post({ label: 'boolean', value: true })
    items.post({ label: 'null', value: null })
    items.post({ label: 'absent' })
    expect(items.get({ value: 1 })).toEqual([{ label: 'number', value: 1 }])
    expect(items.get({ value: '1' })).toEqual([{ label: 'string', value: '1' }])
    expect(items.get({ value: true })).toEqual([{ label: 'boolean', value: true }])
    expect(items.get({ value: null })).toEqual([{ label: 'null', value: null }])
  } finally {
    app.close()
  }
})

test('Filters treat field names and values as literal data', () => {
  const app = new Hedra(quiet)
  const items = new Collection('items', z.object({ 'a.b': z.string(), 'q"': z.string() }))

  app.register(items)
  const value = "' OR 1=1 --"

  try {
    items.post({ 'a.b': value, 'q"': 'yes' })
    items.post({ 'a.b': 'other', 'q"': 'yes' })
    expect(items.get({ 'a.b': value, 'q"': 'yes' })).toEqual([{ 'a.b': value, 'q"': 'yes' }])
    expect(items.delete({ 'a.b': value })).toBe(1)
    expect(items.get()).toEqual([{ 'a.b': 'other', 'q"': 'yes' }])
  } finally {
    app.close()
  }
})

test('PUT and PATCH return zero when no records match', () => {
  const app = new Hedra(quiet)
  const cars = new Collection('cars', z.object({ make: z.string(), year: z.number().int() }))

  app.register(cars)

  try {
    expect(cars.get({ make: 'absent' })).toEqual([])
    expect(cars.put({ make: 'absent' }, { make: 'Toyota', year: 2020 })).toBe(0)
    expect(cars.patch({ make: 'absent' }, { year: 2021 })).toBe(0)
    expect(cars.delete({ make: 'absent' })).toBe(0)
    expect(cars.get()).toEqual([])
  } finally {
    app.close()
  }
})

test('POST follows the model unknown-field policy', () => {
  const app = new Hedra(quiet)
  const stripped = new Collection('stripped', z.object({ name: z.string() }))
  const strict = new Collection('strict', z.strictObject({ name: z.string() }))
  const loose = new Collection('loose', z.looseObject({ name: z.string() }))

  app.register(stripped)
  app.register(strict)
  app.register(loose)

  try {
    const input = { name: 'one', extra: 'value' }

    expect(stripped.post(input)).toEqual({ name: 'one' })
    expect(() => strict.post(input)).toThrow(z.ZodError)
    expect(loose.post(input)).toEqual(input)
    expect(stripped.get()).toEqual([{ name: 'one' }])
    expect(strict.get()).toEqual([])
    expect(loose.get()).toEqual([input])
    // @ts-expect-error Declared fields keep their model types in loose objects.
    expect(() => loose.get({ name: 7 })).toThrow()
  } finally {
    app.close()
  }
})

test('PATCH follows the model unknown-field policy', () => {
  const app = new Hedra(quiet)
  const strict = new Collection('strict', z.strictObject({ name: z.string() }))

  app.register(strict)

  try {
    strict.post({ name: 'one' })
    expect(() => strict.patch({ name: 'one' }, { extra: 'value' } as never)).toThrow(z.ZodError)
    expect(() => strict.patch({ name: 'one' }, JSON.parse('{"__proto__":"value"}'))).toThrow(z.ZodError)
    expect(strict.get()).toEqual([{ name: 'one' }])
  } finally {
    app.close()
  }
})

test('POST rejects invalid model data without inserting a record', () => {
  const app = new Hedra(quiet)
  const cars = new Collection('cars', z.object({ make: z.string(), year: z.number().int() }))

  app.register(cars)

  try {
    // @ts-expect-error The model requires a year.
    expect(() => cars.post({ make: 'Toyota' })).toThrow(z.ZodError)

    for (const input of [{}, { make: 'Toyota', year: '2020' }, { make: 'Toyota', year: 2020.5 }]) {
      expect(() => cars.post(input as never)).toThrow(z.ZodError)
      expect(cars.get()).toEqual([])
    }
  } finally {
    app.close()
  }
})

test('Invalid PUT leaves every matched record unchanged', () => {
  const app = new Hedra(quiet)
  const cars = new Collection('cars', z.object({ make: z.string(), year: z.number().int() }))

  app.register(cars)

  try {
    cars.post({ make: 'Toyota', year: 2020 })
    cars.post({ make: 'Toyota', year: 2021 })
    expect(() => cars.put({ make: 'Toyota' }, { make: 'Honda' } as never)).toThrow(z.ZodError)
    expect(cars.get()).toEqual([
      { make: 'Toyota', year: 2020 },
      { make: 'Toyota', year: 2021 },
    ])
  } finally {
    app.close()
  }
})

test('Collections keep their records separate', () => {
  const app = new Hedra(quiet)
  const cars = new Collection('cars', z.object({ make: z.string(), year: z.number() }))
  const bikes = new Collection('bikes', z.object({ make: z.string(), year: z.number() }))

  app.register(cars)
  app.register(bikes)

  try {
    cars.post({ make: 'Honda', year: 2020 })
    bikes.post({ make: 'Honda', year: 2021 })
    expect(cars.put({ make: 'Honda' }, { make: 'Honda', year: 2022 })).toBe(1)
    expect(cars.patch({ make: 'Honda' }, { year: 2023 })).toBe(1)
    expect(cars.delete({ make: 'Honda' })).toBe(1)
    expect(cars.get()).toEqual([])
    expect(bikes.get()).toEqual([{ make: 'Honda', year: 2021 }])
  } finally {
    app.close()
  }
})

test('Synchronous methods reject asynchronous model validation', () => {
  const app = new Hedra(quiet)
  const items = new Collection(
    'items',
    z.object({ name: z.string() }).refine(async () => true),
  )

  app.register(items)

  try {
    expect(() => items.post({ name: 'one' })).toThrow()
    expect(items.get()).toEqual([])
  } finally {
    app.close()
  }
})

test('GET validates persisted records against the current model', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-models-'))
  const path = join(dir, 'db.sqlite')
  const first = new Hedra({ ...quiet, HEDRA_SQLITE_PATH: path })
  const original = new Collection('items', z.object({ value: z.number() }))

  first.register(original)
  original.post({ value: 1 })
  first.close()

  try {
    const schemas = [
      z.object({ value: z.string() }),
      z.object({ value: z.number().transform((value) => value + 1) }),
      z.object({ value: z.number().transform((value) => new Date(value)) }),
    ]

    for (const schema of schemas) {
      const app = new Hedra({ ...quiet, HEDRA_SQLITE_PATH: path })
      const items = new Collection('items', schema)

      app.register(items)
      try {
        expect(() => items.get()).toThrow()
      } finally {
        app.close()
      }
    }
    const app = new Hedra({ ...quiet, HEDRA_SQLITE_PATH: path })
    const items = new Collection('items', z.object({ value: z.number() }))

    app.register(items)
    try {
      expect(items.get()).toEqual([{ value: 1 }])
    } finally {
      app.close()
    }
  } finally {
    first.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Native write failures preserve existing records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-models-'))
  const path = join(dir, 'db.sqlite')
  const app = new Hedra({ ...quiet, HEDRA_SQLITE_PATH: path })
  const cars = new Collection('cars', z.object({ make: z.string(), year: z.number() }))

  app.register(cars)
  cars.post({ make: 'Toyota', year: 2020 })
  const lock = new Database(path)

  lock.run('BEGIN IMMEDIATE')

  try {
    expect(() => cars.post({ make: 'Honda', year: 2021 })).toThrow('locked')
    expect(() => cars.put({ make: 'Toyota' }, { make: 'Honda', year: 2021 })).toThrow('locked')
    expect(() => cars.patch({ make: 'Toyota' }, { year: 2021 })).toThrow('locked')
    expect(() => cars.delete({ make: 'Toyota' })).toThrow('locked')
  } finally {
    lock.run('ROLLBACK')
    lock.close()
    try {
      expect(cars.get()).toEqual([{ make: 'Toyota', year: 2020 }])
    } finally {
      app.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
