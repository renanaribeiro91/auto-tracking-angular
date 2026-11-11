import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import type { ComponentInfo } from './ports/project-index.js';
import { START_TAG, TemplateAnalysis } from './template-analysis.js';

/** Resolve apenas escolhas numéricas cujo valor é um literal ou uma lista estática no consumidor. */
export interface NumericSelection {
  readonly input: string;
  readonly allowed: readonly string[];
}

export function numericSelectionMethods(component: ComponentInfo, components: readonly ComponentInfo[]): ReadonlyMap<string, NumericSelection> {
  if (component.def.inputs.size === 0 || component.def.outputs.size === 0) return new Map();
  if (components.some((other) => other !== component && other.def.selectors.some((selector) => component.def.selectors.includes(selector)))) return new Map();
  const source = ts.createSourceFile('component.ts', component.classText, ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration);
  if (!declaration) return new Map();
  const outputProperties = new Set(component.def.outputs.values());
  const numericOutputs = new Set(declaration.members.filter((member): member is ts.PropertyDeclaration =>
    ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && outputProperties.has(member.name.text) && !!member.type && ts.isTypeReferenceNode(member.type)
    && ts.isIdentifier(member.type.typeName) && member.type.typeName.text === 'EventEmitter'
    && member.type.typeArguments?.length === 1 && member.type.typeArguments[0]?.kind === ts.SyntaxKind.NumberKeyword,
  ).map((member) => (member.name as ts.Identifier).text));
  const analysis = new TemplateAnalysis();
  const candidates = new Map<string, string>();
  for (const [name, body] of component.def.methods) {
    const parsed = ts.createSourceFile('method.ts', `function action() ${body}`, ts.ScriptTarget.Latest, true);
    const fn = parsed.statements[0];
    if (!fn || !ts.isFunctionDeclaration(fn) || fn.body?.statements.length !== 1) continue;
    const statement = fn.body.statements[0]!;
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'emit'
      || !ts.isPropertyAccessExpression(call.expression.expression) || call.expression.expression.expression.kind !== ts.SyntaxKind.ThisKeyword
      || !numericOutputs.has(call.expression.expression.name.text) || call.arguments.length !== 1) continue;
    const argument = call.arguments[0]!;
    if (ts.isPropertyAccessExpression(argument) && argument.expression.kind === ts.SyntaxKind.ThisKeyword && component.def.inputs.has(argument.name.text)) {
      const input = declaration.members.find((member): member is ts.PropertyDeclaration =>
        ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === argument.name.text);
      if (input && !input.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword)) candidates.set(name, argument.name.text);
    }
  }

  const result = new Map<string, NumericSelection>();
  for (const [method, input] of candidates) {
    let uses = 0;
    let proven = true;
    const allowed = new Set<string>();
    for (const parent of components) {
      const html = parent.def.template.replace(/<!--[\s\S]*?-->/g, '');
      for (const tag of html.matchAll(START_TAG)) {
        if (!component.def.selectors.includes(tag[1]!.toLowerCase())) continue;
        uses++;
        const expression = analysis.parseAttrs(tag[2] ?? '').get(`[${input}]`)?.trim();
        if (expression && /^\d+$/.test(expression)) {
          if (Number.isFinite(Number(expression))) allowed.add(String(Number(expression)));
          else proven = false;
          continue;
        }
        if (!expression || !/^[A-Za-z_$][\w$]*$/.test(expression)) { proven = false; continue; }
        // shortcut: apenas ng-container não aninhado, ampliar quando o parser de template fornecer escopos completos.
        const scopes = [...html.matchAll(/<ng-container\b([^>]*)>([\s\S]*?)<\/ng-container\s*>/g)].filter((scope) =>
          scope.index! < tag.index! && tag.index! < scope.index! + scope[0].length && !scope[2]!.includes('<ng-container'));
        if (scopes.length !== 1) { proven = false; continue; }
        const repeat = analysis.parseAttrs(scopes[0]![1]!).get('*ngFor');
        const loop = repeat && /^\s*let\s+([\w$]+)\s+of\s+([\w$]+)(?:\s*;|\s*$)/.exec(repeat);
        if (!loop || loop[1] !== expression) { proven = false; continue; }
        const parentSource = ts.createSourceFile('parent.ts', parent.classText, ts.ScriptTarget.Latest, true);
        const parentClass = parentSource.statements.find(ts.isClassDeclaration);
        const list = parentClass?.members.find((member): member is ts.PropertyDeclaration =>
          ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === loop[2]);
        if (!list?.initializer || !ts.isArrayLiteralExpression(list.initializer) || list.initializer.elements.length === 0
          || !list.initializer.elements.every((element) => ts.isNumericLiteral(element) && Number.isFinite(Number(element.text)))) proven = false;
        else for (const element of list.initializer.elements) allowed.add(String(Number((element as ts.NumericLiteral).text)));
      }
    }
    if (uses > 0 && proven) result.set(method, { input, allowed: [...allowed].sort() });
  }
  return result;
}

/**
 * Valores literais de `propriedade` em cada item de uma lista declarada na
 * classe (`itens = [{ titulo: 'A' }, …]`). Só listas inteiramente estáticas
 * provam o conjunto; qualquer item não literal invalida a prova.
 */
export function staticListLabels(component: ComponentInfo): (list: string, property: string) => readonly string[] | null {
  let declaration: ts.ClassDeclaration | undefined;
  let parsed = false;
  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  const sources = new Map<string, ts.SourceFile | null>();
  const sourceOf = (file: string): ts.SourceFile | null => {
    if (!sources.has(file)) sources.set(file, fs.existsSync(file) ? ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true) : null);
    return sources.get(file)!;
  };
  const resolve = (expression: ts.Expression, file: string, depth = 0): ts.Expression | null => {
    const value = unwrap(expression);
    if (!ts.isIdentifier(value)) return value;
    if (depth > 4) return null;
    const source = sourceOf(file);
    for (const statement of source?.statements ?? []) {
      if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const)) {
        const item = statement.declarationList.declarations.find((item) => ts.isIdentifier(item.name) && item.name.text === value.text);
        if (item?.initializer) return resolve(item.initializer, file, depth + 1);
      }
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
      const bindings = statement.importClause?.namedBindings;
      const imported = bindings && ts.isNamedImports(bindings) ? bindings.elements.find((item) => item.name.text === value.text) : null;
      if (!imported) continue;
      const base = path.resolve(path.dirname(file), statement.moduleSpecifier.text.replace(/\.js$/, ''));
      const target = [base + '.ts', path.join(base, 'index.ts')].find((candidate) => fs.existsSync(candidate));
      return target ? resolve(ts.factory.createIdentifier((imported.propertyName ?? imported.name).text), target, depth + 1) : null;
    }
    return null;
  };
  return (list, property) => {
    if (!parsed) {
      parsed = true;
      declaration = ts.createSourceFile('component.ts', component.classText, ts.ScriptTarget.Latest, true).statements.find(ts.isClassDeclaration);
    }
    const member = declaration?.members.find((item): item is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(item) && ts.isIdentifier(item.name) && item.name.text === list);
    const assignments: ts.Expression[] = member?.initializer ? [member.initializer] : [];
    const collect = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)
        && node.left.expression.kind === ts.SyntaxKind.ThisKeyword && node.left.name.text === list) assignments.push(node.right);
      ts.forEachChild(node, collect);
    };
    if (declaration) collect(declaration);
    const arrays = assignments.map((expression) => resolve(expression, component.tsFile));
    if (!arrays.length || arrays.some((value) => !value || !ts.isArrayLiteralExpression(value))) return null;
    const elements = arrays.flatMap((value) => [...(value as ts.ArrayLiteralExpression).elements]);
    if (!elements.length) return null;
    const values: string[] = [];
    for (const element of elements) {
      const item = unwrap(element as ts.Expression);
      if (!ts.isObjectLiteralExpression(item)) return null;
      const assignment = item.properties.find((entry): entry is ts.PropertyAssignment => ts.isPropertyAssignment(entry)
        && (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) && entry.name.text === property);
      const value = assignment && unwrap(assignment.initializer);
      if (!value || !ts.isStringLiteralLike(value)) return null;
      values.push(value.text);
    }
    return values;
  };
}

/**
 * Campos declarados no tipo do item de uma lista da classe (`lista: Item[]`),
 * resolvido no próprio arquivo ou em import relativo. `null` sem prova do tipo.
 */
export function listItemFields(component: ComponentInfo): (list: string) => readonly string[] | null {
  const fieldsOf = (source: ts.SourceFile, name: string): string[] | null => {
    for (const statement of source.statements) {
      const members = ts.isInterfaceDeclaration(statement) && statement.name.text === name ? statement.members
        : ts.isTypeAliasDeclaration(statement) && statement.name.text === name && ts.isTypeLiteralNode(statement.type) ? statement.type.members
          : null;
      if (members) return members.filter(ts.isPropertySignature).map((member) => member.name.getText(source));
    }
    return null;
  };
  return (list) => {
    const source = ts.createSourceFile('component.ts', component.classText, ts.ScriptTarget.Latest, true);
    const member = source.statements.find(ts.isClassDeclaration)?.members.find((item): item is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(item) && ts.isIdentifier(item.name) && item.name.text === list);
    const type = member?.type;
    const element = type && ts.isArrayTypeNode(type) ? type.elementType
      : type && ts.isTypeReferenceNode(type) && ['Array', 'ReadonlyArray'].includes(type.typeName.getText(source)) ? type.typeArguments?.[0] : undefined;
    if (!element || !ts.isTypeReferenceNode(element) || !ts.isIdentifier(element.typeName)) return null;
    const name = element.typeName.text;
    const local = fieldsOf(source, name);
    if (local || !component.tsFile || !fs.existsSync(component.tsFile)) return local;
    const file = ts.createSourceFile(component.tsFile, fs.readFileSync(component.tsFile, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
      const bindings = statement.importClause?.namedBindings;
      const imported = bindings && ts.isNamedImports(bindings) ? bindings.elements.find((item) => item.name.text === name) : null;
      if (!imported) continue;
      const base = path.resolve(path.dirname(component.tsFile), statement.moduleSpecifier.text.replace(/\.js$/, ''));
      const target = [base + '.ts', path.join(base, 'index.ts')].find((candidate) => fs.existsSync(candidate));
      return target ? fieldsOf(ts.createSourceFile(target, fs.readFileSync(target, 'utf8'), ts.ScriptTarget.Latest, true), (imported.propertyName ?? imported.name).text) : null;
    }
    return local;
  };
}

/**
 * Método que só embrulha outro (uma instrução, um único `this.metodo()` da classe, com ou sem condição) é nomeado pelo
 * método chamado, seguindo a cadeia: `ajustaSwipe() { this.tema === '' ? this.voltarPagina() : null; }` → `voltarPagina`.
 * `null` quando o método faz mais de uma coisa ou não chama método da classe.
 */
export function methodDelegate(component: ComponentInfo): (method: string) => string | null {
  return (method) => {
    let current = method;
    for (let depth = 0; depth < 4; depth++) {
      const body = component.methods.get(current);
      const block = body === undefined ? undefined : ts.createSourceFile('method.ts', `function m() ${body.trim().startsWith('{') ? body : `{ ${body} }`}`, ts.ScriptTarget.Latest, true)
        .statements[0];
      const statements = block && ts.isFunctionDeclaration(block) ? block.body?.statements : undefined;
      if (!statements || statements.length !== 1) break;
      const called = new Set<string>();
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
          && component.methods.has(node.expression.name.text)) called.add(node.expression.name.text);
        ts.forEachChild(node, visit);
      };
      visit(statements[0]!);
      if (called.size !== 1) break;
      current = [...called][0]!;
    }
    return current === method ? null : current;
  };
}
