import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import type { ComponentInfo } from './ports/project-index.js';

const MAX_DEPTH = 12;
/** Chamadas que embrulham um valor do tipo do argumento genérico (`signal<T>()`, `input<T>()`, `new BehaviorSubject<T>()`). */
const WRAPPERS = /^(?:signal|input|model|computed|linkedSignal|BehaviorSubject|ReplaySubject|Subject|required)$/;

/** Tipos que só embrulham o valor (lista, fluxo reativo, promessa): os campos são os do argumento. */
const CONTAINERS: ReadonlySet<string> = new Set(['Array', 'ReadonlyArray', 'Observable', 'Signal', 'WritableSignal', 'InputSignal', 'ModelSignal',
  'BehaviorSubject', 'ReplaySubject', 'Subject', 'Promise', 'Readonly', 'Partial', 'Required']);

type Scope = { readonly node: ts.TypeNode; readonly file: string };

/**
 * Campos declarados do tipo de um caminho do componente (`agendas.horas`, `select.model.id`), lido só pelo código:
 * anotação do membro, genérico de `signal`/`input`/`BehaviorSubject`, interface (com `extends`), `type`, classe,
 * array e união com `null`/`undefined`, em arquivo local ou importado por caminho relativo. `null` quando o código
 * não declara o tipo (`any`, sem anotação, tipo de biblioteca): não há prova.
 */
export function typeFields(component: ComponentInfo): (ownerPath: string) => readonly string[] | null {
  const files = new Map<string, ts.SourceFile | null>();
  const sourceOf = (file: string): ts.SourceFile | null => {
    if (!files.has(file)) files.set(file, fs.existsSync(file) ? ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true) : null);
    return files.get(file)!;
  };

  /** Declaração de tipo pelo nome no arquivo ou em import relativo. */
  const declaration = (name: string, file: string, depth: number): { node: ts.Node; file: string } | null => {
    const source = sourceOf(file);
    if (!source || depth > MAX_DEPTH) return null;
    for (const statement of source.statements) {
      if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isClassDeclaration(statement))
        && statement.name?.text === name) return { node: statement, file };
    }
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
      const bindings = statement.importClause?.namedBindings;
      const imported = bindings && ts.isNamedImports(bindings) ? bindings.elements.find((element) => element.name.text === name) : undefined;
      if (!imported) continue;
      const base = path.resolve(path.dirname(file), statement.moduleSpecifier.text.replace(/\.js$/, ''));
      const target = [`${base}.ts`, path.join(base, 'index.ts')].find((candidate) => fs.existsSync(candidate));
      return target ? declaration((imported.propertyName ?? imported.name).text, target, depth + 1) : null;
    }
    return null;
  };

  /** Tipo sem `null`/`undefined` e sem array: o que tem campos. */
  const unwrap = (scope: Scope): Scope | null => {
    let node = scope.node;
    while (true) {
      if (ts.isParenthesizedTypeNode(node)) node = node.type;
      else if (ts.isArrayTypeNode(node)) node = node.elementType;
      else if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && CONTAINERS.has(node.typeName.text) && node.typeArguments?.[0]) node = node.typeArguments[0];
      else if (ts.isUnionTypeNode(node)) {
        const real = node.types.filter((type) => !(ts.isLiteralTypeNode(type) && type.literal.kind === ts.SyntaxKind.NullKeyword) && type.kind !== ts.SyntaxKind.UndefinedKeyword);
        if (real.length !== 1) return null;
        node = real[0]!;
      } else return { node, file: scope.file };
    }
  };

  /** Membros (nome → tipo) do tipo, com os herdados por `extends`. */
  const members = (scope: Scope, depth: number): Map<string, Scope> | null => {
    const target = unwrap(scope);
    if (!target || depth > MAX_DEPTH) return null;
    const fromList = (list: ts.NodeArray<ts.TypeElement | ts.ClassElement>, file: string, into = new Map<string, Scope>()) => {
      for (const member of list) {
        const name = member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ? member.name.text : undefined;
        if (!name) continue;
        const type = (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) ? member.type : undefined;
        into.set(name, type ? { node: type, file } : { node: ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword), file });
      }
      return into;
    };
    if (ts.isTypeLiteralNode(target.node)) return fromList(target.node.members, target.file);
    if (!ts.isTypeReferenceNode(target.node) || !ts.isIdentifier(target.node.typeName)) return null;
    const found = declaration(target.node.typeName.text, target.file, 0);
    if (!found) return null;
    const node = found.node;
    if (ts.isTypeAliasDeclaration(node)) return members({ node: node.type, file: found.file }, depth + 1);
    if (!ts.isInterfaceDeclaration(node) && !ts.isClassDeclaration(node)) return null;
    const result = fromList(node.members as ts.NodeArray<ts.TypeElement | ts.ClassElement>, found.file);
    for (const clause of node.heritageClauses ?? []) for (const parent of clause.types) {
      if (!ts.isIdentifier(parent.expression)) return null;
      const inherited = members({ node: ts.factory.createTypeReferenceNode(parent.expression.text), file: found.file }, depth + 1);
      if (!inherited) return null;
      for (const [name, type] of inherited) if (!result.has(name)) result.set(name, type);
    }
    return result;
  };

  /** Tipo de um membro da classe do componente: anotação ou genérico do embrulho reativo. */
  const memberType = (name: string): Scope | null => {
    const source = sourceOf(component.tsFile);
    const owner = source?.statements.find((statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement) && statement.name?.text === component.className);
    const member = owner?.members.find((item) => item.name?.getText() === name);
    if (!member) return null;
    if ((ts.isPropertyDeclaration(member) || ts.isGetAccessor(member)) && member.type) return { node: member.type, file: component.tsFile };
    let init = ts.isPropertyDeclaration(member) ? member.initializer : undefined;
    while (init && (ts.isCallExpression(init) || ts.isNewExpression(init))) {
      const callee = init.expression;
      const called = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (!WRAPPERS.test(called)) return null;
      if (init.typeArguments?.[0]) return { node: init.typeArguments[0], file: component.tsFile };
      init = undefined;
    }
    return null;
  };

  return (ownerPath) => {
    const [root, ...rest] = ownerPath.replace(/\?\./g, '.').split('.').filter(Boolean);
    let scope = root ? memberType(root) : null;
    for (const segment of rest) {
      if (!scope) return null;
      scope = members(scope, 0)?.get(segment) ?? null;
      if (scope && scope.node.kind === ts.SyntaxKind.AnyKeyword) return null;
    }
    const fields = scope ? members(scope, 0) : null;
    return fields ? [...fields.keys()] : null;
  };
}
