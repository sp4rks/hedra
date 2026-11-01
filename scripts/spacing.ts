import type { AnyJsAstNode } from '@biomejs/runtime/plugin'
import { ast, defineRule, registerDiagnostic } from '@biomejs/runtime/plugin'

const spaceBefore = new Set([
  'JS_RETURN_STATEMENT',
  'JS_FOR_STATEMENT',
  'JS_FOR_IN_STATEMENT',
  'JS_FOR_OF_STATEMENT',
  'JS_WHILE_STATEMENT',
  'JS_DO_WHILE_STATEMENT',
])

/** Identifies local and exported variable declarations. */
function isVariable(statement: AnyJsAstNode | undefined) {
  return (
    statement?.kind === 'JS_VARIABLE_STATEMENT' ||
    (statement?.kind === 'JS_EXPORT' && statement.exportClause?.kind === 'JS_VARIABLE_DECLARATION_CLAUSE')
  )
}

export const statementSpacing = defineRule({
  query: ast('JS_STATEMENT_LIST', 'JS_MODULE_ITEM_LIST'),
  /** Reports missing separators between statements. */
  run(list) {
    const source = list.text
    const statements = list.children()
    let position = 0

    for (const [index, statement] of statements.entries()) {
      let spacing = ''

      for (;;) {
        const trivia = source.slice(position).match(/^(?:\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/)

        if (!trivia) break

        const piece = trivia[0]

        // Newlines inside comments do not separate statements.
        spacing += piece.startsWith('/') ? 'x' : piece
        position += piece.length
      }

      const followsVariables = index > 0 && isVariable(statements[index - 1]) && !isVariable(statement)

      if (
        index > 0 &&
        (spaceBefore.has(statement.kind) || followsVariables) &&
        !/\n[ \t]*\n/.test(spacing.replace(/\r\n?/g, '\n'))
      ) {
        registerDiagnostic(statement, 'error', 'Leave a blank line before this statement.')
      }

      position += statement.text.length
    }
  },
})
