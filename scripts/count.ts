let lines = 0

for await (const path of new Bun.Glob('src/**/*.ts').scan()) {
  if (/(^|\/)(tests?|__tests__)\//.test(path) || /\.(test|spec)\.ts$/.test(path)) continue

  const source = await Bun.file(path).text()

  lines += source.split(/\r?\n/).filter((line) => line.trim().length > 0).length
}

process.stdout.write(`TypeScript lines (src; excluding tests and blank lines; including comments): ${lines}\n`)
