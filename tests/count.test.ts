import { expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('bun run count counts only nonblank src TypeScript lines and excludes tests', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hedra-count-'))

  try {
    copyFileSync(join(import.meta.dir, '../package.json'), join(root, 'package.json'))
    await Bun.write(join(root, 'scripts/count.ts'), Bun.file(join(import.meta.dir, '../scripts/count.ts')))

    await Bun.write(join(root, 'src/nested/source.ts'), 'const first = 1\n\n  \n// A comment.\nconst last = 2')
    await Bun.write(join(root, 'src/crlf.ts'), 'export {}\r\n')
    await Bun.write(join(root, 'examples/example.ts'), 'excluded\n')
    await Bun.write(join(root, 'scripts/tool.ts'), 'export {}\n')
    await Bun.write(join(root, 'src/empty.ts'), '')
    await Bun.write(join(root, 'tests/source.test.ts'), 'excluded\n')
    await Bun.write(join(root, 'src/source.test.ts'), 'excluded\n')
    await Bun.write(join(root, 'src/source.spec.ts'), 'excluded\n')
    await Bun.write(join(root, 'src/__tests__/fixture.ts'), 'excluded\n')
    await Bun.write(join(root, 'src/tests/fixture.ts'), 'excluded\n')
    await Bun.write(join(root, 'docs/example.ts'), 'excluded\n')
    await Bun.write(join(root, 'node_modules/example.ts'), 'excluded\n')
    await Bun.write(join(root, 'src/readme.md'), 'excluded\n')

    const after = Bun.spawnSync(['bun', 'run', 'count'], { cwd: root })

    expect(after.exitCode).toBe(0)
    expect(after.stdout.toString().trim()).toBe(
      'TypeScript lines (src; excluding tests and blank lines; including comments): 4',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
