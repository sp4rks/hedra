let lines = 0

for await (const path of new Bun.Glob('{src,examples,scripts}/**/*.ts').scan()) {
  if (/(^|\/)(tests?|__tests__)\//.test(path) || /\.(test|spec)\.ts$/.test(path)) continue

  const source = await Bun.file(path).text()

  lines += source.split(/\r?\n/).filter((line) => line.trim().length > 0).length
}

process.stdout.write(
  `TypeScript lines (src, examples, scripts; excluding tests and blank lines; including comments): ${lines}\n`,
)
