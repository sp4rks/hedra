import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const project = join(import.meta.dir, '..')
const biome = join(project, 'node_modules', '.bin', 'biome')

/** Runs Biome on a temporary TypeScript source file. */
function lint(source: string) {
  const directory = mkdtempSync(join(tmpdir(), 'hedra-spacing-'))
  const fixture = join(directory, 'sample.ts')

  try {
    writeFileSync(fixture, source)

    return Bun.spawnSync({
      cmd: [biome, 'lint', '--only=plugin', '--vcs-enabled=false', `--config-path=${project}`, fixture],
      cwd: project,
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('Biome reports a missing blank line before a return', () => {
  const result = lint('export function value() {\n  const value = 1\n  return value\n}\n')

  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('blank line')
})

test.each([
  'for (let i = 0; i < 1; i++) {}',
  'for (const value of values) {}',
  'for (const key in values) {}',
  'for await (const value of values) {}',
  'while (false) {}',
  'do {} while (false)',
])('Biome reports a missing blank line before %s', (loop) => {
  const result = lint(`export async function example() {\n  start()\n  ${loop}\n}\n`)

  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('blank line')
})

test.each([
  'export function example() {\n  const first = 1\n  let second = 2\n  var third = 3\n  use(first, second, third)\n}\n',
  'export const first = 1\nexport let second = 2\nexport var third = 3\nuse(first, second, third)\n',
])('Biome reports a missing blank line after a declaration group', (source) => {
  const result = lint(source)

  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('blank line')
})

test.each([
  ['an only return', 'export function example() { return 1 }\n'],
  ['a first loop', 'export function example() { for (;;) { break } }\n'],
  ['a declaration at the end of a block', 'export function example() { const value = 1 }\n'],
  ['consecutive declarations', 'export const first = 1\nexport let second = 2\n'],
  [
    'multiline declarations and template content',
    'export function example() {\n  const value = {\n    text: `return; for (;;)`,\n  }\n  let other = 2\n\n  use(value, other)\n}\n',
  ],
  ['a blank before an intervening comment', 'export function example() {\n  use()\n\n  // return 1\n  return 1\n}\n'],
  ['CRLF separators', 'export function example() {\r\n  use()\r\n\r\n  while (false) {}\r\n}\r\n'],
  ['a nested first return', 'export function example() {\n  if (ready) { return 1 }\n\n  return 2\n}\n'],
])('Biome accepts %s', (_name, source) => {
  const result = lint(source)

  expect(result.exitCode).toBe(0)
})

test.each([
  [
    'a blank-looking line inside a block comment',
    'export function example() {\n  use()\n  /* comment\n\n     continues */\n  return 1\n}\n',
  ],
  ['a comment without a blank line', 'export function example() {\n  use()\n  // return 1\n  return 1\n}\n'],
  [
    'a nested declaration group',
    'export function example() {\n  if (ready) {\n    const value = 1\n    use(value)\n  }\n}\n',
  ],
])('Biome rejects %s', (_name, source) => {
  const result = lint(source)

  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('blank line')
})

test('Biome checks statements within a switch case', () => {
  const result = lint(
    'export function example(value: number) {\n  switch (value) {\n    case 1:\n      use()\n      return value\n  }\n}\n',
  )

  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('blank line')
})

test('Biome accepts sole unbraced return and loop bodies', () => {
  const result = lint('export function example() {\n  if (ready) return 1\n  if (other) while (condition) step()\n}\n')

  expect(result.exitCode).toBe(0)
})

test('Biome rejects a missing blank line with CRLF line endings', () => {
  const result = lint('export function example() {\r\n  use()\r\n  return 1\r\n}\r\n')

  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('blank line')
})

test.each([
  'const first = 1\ndeclare const second: number\ndeclare let third: number\ndeclare var fourth: number\nconst last = 5\n\nuse(first, second, third, fourth, last)\n',
  'export const first = 1\nexport declare const second: number\nexport declare let third: number\nexport declare var fourth: number\nexport const last = 5\n\nuse(first, second, third, fourth, last)\n',
])('Biome accepts mixed ambient variable declaration groups', (source) => {
  const result = lint(source)

  expect(result.exitCode).toBe(0)
})

test.each([
  'declare const value: number',
  'declare let value: number',
  'declare var value: number',
  'export declare const value: number',
  'export declare let value: number',
  'export declare var value: number',
])('Biome requires a blank line after %s', (declaration) => {
  const result = lint(`${declaration}\nuse(value)\n`)

  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('blank line')
})

test.each(['declare class Thing {}', 'export declare function use(): void'])(
  'Biome treats %s as the end of a variable group',
  (declaration) => {
    const result = lint(`const value = 1\n${declaration}\n`)

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('blank line')
  },
)
