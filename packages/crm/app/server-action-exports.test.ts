import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

function isUseServerModule(sourceFile: ts.SourceFile): boolean {
  const first = sourceFile.statements[0];
  return Boolean(first
    && ts.isExpressionStatement(first)
    && ts.isStringLiteral(first.expression)
    && first.expression.text === 'use server');
}

function runtimeExportViolation(statement: ts.Statement): boolean {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return false;

  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return false;
    return !statement.exportClause
      || !ts.isNamedExports(statement.exportClause)
      || statement.exportClause.elements.some((element) => !element.isTypeOnly);
  }

  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return false;
  return !ts.isFunctionDeclaration(statement)
    || !hasModifier(statement, ts.SyntaxKind.AsyncKeyword);
}

describe('server action module exports', () => {
  it('exports only async functions or erased TypeScript types from use-server modules', () => {
    const appRoot = resolve(process.cwd(), 'app');
    const scanned: string[] = [];
    const violations: string[] = [];

    for (const file of sourceFiles(appRoot)) {
      const source = readFileSync(file, 'utf8');
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      if (!isUseServerModule(sourceFile)) continue;
      scanned.push(relative(appRoot, file));

      sourceFile.statements.forEach((statement) => {
        if (runtimeExportViolation(statement)) {
          const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart()).line + 1;
          violations.push(`${relative(appRoot, file)}:${line}`);
        }
      });
    }

    expect(scanned.length).toBeGreaterThan(0);
    expect(violations, 'Runtime values in a use-server module crash Next.js server actions').toEqual([]);
  });
});
