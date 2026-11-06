import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BackendTransaction } from '#hedra.ts'
import { SqliteBackend } from '#hedra.ts'

test('backend transactions commit or roll back changes across collections', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    await backend.transaction((transaction) => {
      transaction.insert('cars', { id: 'car' })
      transaction.insert('links', { id: 'link', car: 'car' })
    })
    expect(await backend.select('cars')).toEqual([{ id: 'car' }])
    expect(await backend.select('links')).toEqual([{ id: 'link', car: 'car' }])
    await expect(
      backend.transaction((transaction) => {
        transaction.delete('cars', 'car')
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(await backend.select('cars')).toEqual([{ id: 'car' }])
  } finally {
    backend.close()
  }
})

test('transaction sessions expire and asynchronous callbacks cannot commit', async () => {
  const backend = new SqliteBackend(':memory:')
  let saved: BackendTransaction | undefined

  try {
    await backend.transaction((transaction) => {
      saved = transaction
    })
    expect(() => saved?.insert('cars', { id: 'late' })).toThrow('no longer active')
    await expect(
      backend.transaction(async (transaction) => {
        transaction.insert('cars', { id: 'early' })
        await Promise.resolve()
        transaction.insert('cars', { id: 'late' })
      }),
    ).rejects.toThrow('synchronous')
    expect(await backend.select('cars')).toEqual([])
  } finally {
    backend.close()
  }
})

test('transaction results may contain a non-callable then field', async () => {
  const backend = new SqliteBackend(':memory:')
  const value: unknown = JSON.parse('{"then":"literal"}')

  try {
    expect(await backend.transaction(() => value)).toEqual(value)
  } finally {
    backend.close()
  }
})

test('competing backends cannot create a link and delete its endpoint independently', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hedra-association-race-'))
  const path = join(directory, 'data.sqlite')
  const first = new SqliteBackend(path)
  const second = new SqliteBackend(path)
  let competing: Promise<boolean> | undefined

  try {
    await first.insert('resources', { id: 'target' })
    await first.transaction((transaction) => {
      expect(transaction.select('resources', { id: 'target' })).toHaveLength(1)
      transaction.insert('links', { id: 'link', target: 'target' })
      competing = second
        .transaction((other) => {
          if (!other.select('links', { target: 'target' }).length) other.delete('resources', 'target')
        })
        .then(
          () => true,
          () => false,
        )
    })
    await competing
    expect(await first.select('links', { target: 'target' })).toHaveLength(1)
    expect(await first.select('resources', { id: 'target' })).toHaveLength(1)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
