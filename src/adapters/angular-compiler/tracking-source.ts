import ts from 'typescript';

interface Edit { readonly start: number; readonly end: number; readonly text: string }

/** Reconcilia exclusivamente imports e tokens da API de tracking, sem alterar bootstrap ou DI de negócio. */
export function reconcileTrackingSource(text: string, file = 'tracking.ts'): string {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = source.statements.filter(ts.isImportDeclaration);
  const tracking = new Map<string, ts.ImportDeclaration>();
  for (const declaration of imports) {
    if (!ts.isStringLiteral(declaration.moduleSpecifier) || declaration.moduleSpecifier.text !== 'auto-tracking-angular') continue;
    const bindings = declaration.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      if ((item.propertyName ?? item.name).text === 'AutoTrackingSurfaces') tracking.set(item.name.text, declaration);
    }
  }
  if (!tracking.size) return text;
  const angular = imports.filter((declaration) => ts.isStringLiteral(declaration.moduleSpecifier)
    && declaration.moduleSpecifier.text === '@angular/core');
  const injectNames = new Set<string>();
  const injectImports = new Map<string, ts.ImportDeclaration>();
  let injectName: string | undefined;
  let injectImport: ts.ImportDeclaration | undefined;
  for (const declaration of angular) {
    const bindings = declaration.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      injectNames.add(`${bindings.name.text}.Inject`);
      injectImports.set(`${bindings.name.text}.Inject`, declaration);
      if (!injectName) { injectName = `${bindings.name.text}.Inject`; injectImport = declaration; }
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if ((item.propertyName ?? item.name).text !== 'Inject') continue;
        injectNames.add(item.name.text); injectImports.set(item.name.text, declaration);
        injectName = item.name.text; injectImport = declaration;
      }
    }
  }
  const edits: Edit[] = [];
  const values = new Map<ts.ImportDeclaration, Set<string>>();
  const requireValue = (declaration: ts.ImportDeclaration, name: string): void => {
    const names = values.get(declaration) ?? new Set<string>(); names.add(name); values.set(declaration, names);
  };
  const pending: { parameter: ts.ParameterDeclaration; token: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isConstructorDeclaration(node)) for (const parameter of node.parameters) {
      let type = parameter.type;
      while (type && ts.isParenthesizedTypeNode(type)) type = type.type;
      const members = type && ts.isUnionTypeNode(type) ? type.types : type ? [type] : [];
      const token = members.find((member) => ts.isTypeReferenceNode(member)
        && ts.isIdentifier(member.typeName) && tracking.has(member.typeName.text));
      if (!token || !ts.isTypeReferenceNode(token) || !ts.isIdentifier(token.typeName)) continue;
      const name = token.typeName.text;
      requireValue(tracking.get(name)!, name);
      const hasInject = (ts.getDecorators(parameter) ?? []).some((decorator) => {
        if (!ts.isCallExpression(decorator.expression)) return false;
        const name = decorator.expression.expression.getText(source);
        if (!injectNames.has(name)) return false;
        requireValue(injectImports.get(name)!, name.split('.')[0]!); return true;
      });
      if (members.length > 1 && !hasInject) pending.push({ parameter, token: name });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (pending.length) {
    if (!injectName) {
      const identifiers = new Set<string>();
      const collect = (node: ts.Node): void => { if (ts.isIdentifier(node)) identifiers.add(node.text); ts.forEachChild(node, collect); };
      collect(source);
      injectName = 'Inject';
      for (let suffix = 1; identifiers.has(injectName); suffix++) injectName = `AutoTrackingInject${suffix === 1 ? '' : suffix}`;
      const alias = injectName === 'Inject' ? '' : ` as ${injectName}`;
      const existing = angular.find((declaration) => declaration.importClause?.namedBindings && ts.isNamedImports(declaration.importClause.namedBindings));
      const bindings = existing?.importClause?.namedBindings;
      if (existing && bindings && ts.isNamedImports(bindings)) {
        const last = bindings.elements[bindings.elements.length - 1];
        if (last) {
          const multiline = text.slice(bindings.getStart(source), bindings.end).includes('\n');
          const indent = /^[\t ]*/.exec(text.slice(text.lastIndexOf('\n', last.getStart(source)) + 1))?.[0] ?? '';
          edits.push({ start: last.end, end: last.end, text: `,${multiline ? `\n${indent}` : ' '}Inject${alias}` });
        } else edits.push({ start: bindings.end - 1, end: bindings.end - 1, text: ` Inject${alias} ` });
        requireValue(existing, injectName);
      } else {
        const at = imports[imports.length - 1]?.end ?? 0;
        edits.push({ start: at, end: at, text: `${at ? '\n' : ''}import { Inject${alias} } from '@angular/core';${at ? '' : '\n'}` });
      }
    } else if (injectImport) requireValue(injectImport, injectName.split('.')[0]!);
    for (const { parameter, token } of pending) edits.push({ start: parameter.getStart(source), end: parameter.getStart(source), text: `@${injectName}(${token}) ` });
  }
  for (const [declaration, names] of values) {
    const clause = declaration.importClause!;
    const bindings = clause.namedBindings;
    if (clause.isTypeOnly && bindings) {
      const start = clause.getStart(source);
      const offset = /\btype\s+/.exec(text.slice(start, bindings.getStart(source)));
      if (offset) edits.push({ start: start + offset.index, end: start + offset.index + offset[0].length, text: '' });
      if (ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if (!names.has(item.name.text) && !item.isTypeOnly) edits.push({ start: item.getStart(source), end: item.getStart(source), text: 'type ' });
      }
    }
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      if (!names.has(item.name.text) || !item.isTypeOnly) continue;
      const start = item.getStart(source);
      const length = /^type\s+/.exec(text.slice(start, item.name.end))?.[0].length ?? 0;
      if (length) edits.push({ start, end: start + length, text: '' });
    }
  }
  return edits.sort((a, b) => b.start - a.start).reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), text);
}
