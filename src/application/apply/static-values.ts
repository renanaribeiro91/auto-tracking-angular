import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import type { ComponentInfo } from './ports/project-index.js';

/**
 * Valor possível de uma expressão, calculado só pelo código. Uma expressão pode valer vários (ternário, várias
 * atribuições); lista guarda as possibilidades de qualquer item. `unknown` é dado de runtime (store, API, parâmetro).
 */
type Value = { readonly t: 'str'; readonly v: string } | { readonly t: 'obj'; readonly p: ReadonlyMap<string, Values> }
  | { readonly t: 'arr'; readonly items: Values } | { readonly t: 'other' } | { readonly t: 'unknown' };
type Values = readonly Value[];

const UNKNOWN: Values = [{ t: 'unknown' }];
/** Operações de lista que só removem, reordenam ou juntam itens: os possíveis continuam os mesmos. */
const SUBSET_METHODS = new Set(['filter', 'slice', 'sort', 'reverse', 'toSorted', 'toReversed', 'concat']);
/** Métodos que alteram a lista no lugar: com eles o conteúdo deixa de ser provado. */
const MUTATORS = new Set(['push', 'unshift', 'splice', 'fill', 'copyWithin']);
const MAX_DEPTH = 12;
/** Combinações de spread acima disso não são avaliadas: a prova fica com o runtime. */
const MAX_OBJECTS = 256;

/**
 * Rótulos possíveis de `field` nos itens de uma lista do componente, inclusive aninhada (`secoes.servicos`): segue
 * constantes locais e importadas, spread, `map`, `filter`/`slice`/`sort`/`concat`, ternário e retorno de método.
 * Qualquer parte vinda de runtime devolve `null`. O conjunto é um limite superior: o que aparece na tela está nele.
 */
export function staticNestedLabels(component: ComponentInfo): (list: string, field: string) => readonly string[] | null {
  const files = new Map<string, ts.SourceFile | null>();
  const sourceOf = (file: string): ts.SourceFile | null => {
    if (!files.has(file)) files.set(file, fs.existsSync(file) ? ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true) : null);
    return files.get(file)!;
  };
  let declaration: ts.ClassDeclaration | undefined;
  const classOf = () => declaration ??= sourceOf(component.tsFile)?.statements.find((statement): statement is ts.ClassDeclaration =>
    ts.isClassDeclaration(statement) && statement.name?.text === component.className);

  /** Declaração de topo `const name = …` no arquivo ou importada por caminho relativo. */
  const constant = (name: string, file: string, depth: number): { expression: ts.Expression; file: string } | null => {
    const source = sourceOf(file);
    if (!source || depth > MAX_DEPTH) return null;
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
        const item = statement.declarationList.declarations.find((declared) => ts.isIdentifier(declared.name) && declared.name.text === name);
        if (item?.initializer) return { expression: item.initializer, file };
      }
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
      const bindings = statement.importClause?.namedBindings;
      const imported = bindings && ts.isNamedImports(bindings) ? bindings.elements.find((element) => element.name.text === name) : undefined;
      if (!imported) continue;
      const base = path.resolve(path.dirname(file), statement.moduleSpecifier.text.replace(/\.js$/, ''));
      const target = [`${base}.ts`, path.join(base, 'index.ts')].find((candidate) => fs.existsSync(candidate));
      return target ? constant((imported.propertyName ?? imported.name).text, target, depth + 1) : null;
    }
    return null;
  };

  const member = (owner: ts.ClassDeclaration, name: string) => owner.members.find((item) => item.name?.getText() === name);
  /** Membro sem prova quando é mutado no lugar (`this.lista.push`) ou recebe valor por input/decorator. */
  const mutated = (owner: ts.ClassDeclaration, name: string): boolean => {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && MUTATORS.has(node.expression.name.text)
        && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword
        && node.expression.expression.name.text === name) found = true;
      ts.forEachChild(node, visit);
    };
    visit(owner);
    return found;
  };

  const evaluate = (expression: ts.Expression, file: string, env: ReadonlyMap<string, Values>, depth: number): Values => {
    if (depth > MAX_DEPTH) return UNKNOWN;
    let node = expression;
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
    const next = (child: ts.Expression, scope = env) => evaluate(child, file, scope, depth + 1);
    if (ts.isStringLiteralLike(node)) return [{ t: 'str', v: node.text }];
    if (ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
      || node.kind === ts.SyntaxKind.NullKeyword || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return [{ t: 'other' }];
    if (ts.isConditionalExpression(node)) return [...next(node.whenTrue), ...next(node.whenFalse)];
    if (ts.isArrayLiteralExpression(node)) {
      const items = node.elements.flatMap((element) => ts.isSpreadElement(element)
        ? next(element.expression).flatMap((value) => value.t === 'arr' ? value.items : UNKNOWN) : next(element));
      return [{ t: 'arr', items }];
    }
    if (ts.isObjectLiteralExpression(node)) {
      // Spread de um valor com várias possibilidades gera um objeto por possibilidade.
      let objects: Map<string, Values>[] = [new Map()];
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = next(property.expression);
          if (!spread.length || spread.some((value) => value.t !== 'obj') || objects.length * spread.length > MAX_OBJECTS) return UNKNOWN;
          objects = objects.flatMap((props) => spread.map((value) => new Map([...props, ...(value as { p: ReadonlyMap<string, Values> }).p])));
        } else if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
          const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText();
          objects.forEach((props) => props.set(key, next(property.initializer)));
        } else if (ts.isShorthandPropertyAssignment(property)) {
          objects.forEach((props) => props.set(property.name.text, next(property.name)));
        } else return UNKNOWN;
      }
      return objects.map((props) => ({ t: 'obj', p: props }));
    }
    if (ts.isIdentifier(node)) {
      const bound = env.get(node.text);
      if (bound) return bound;
      const declared = constant(node.text, file, 0);
      return declared ? evaluate(declared.expression, declared.file, new Map(), depth + 1) : UNKNOWN;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ThisKeyword) return memberValues(node.name.text, depth + 1);
      return next(node.expression).flatMap((value) => value.t === 'obj' ? value.p.get(node.name.text) ?? UNKNOWN : UNKNOWN);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) return methodValues(method, depth + 1);
      const target = next(node.expression.expression);
      if (SUBSET_METHODS.has(method)) {
        const extra = method === 'concat' ? node.arguments.flatMap((argument) => next(argument).flatMap((value) => value.t === 'arr' ? value.items : [value])) : [];
        return target.map((value) => value.t === 'arr' ? { t: 'arr', items: [...value.items, ...extra] } : { t: 'unknown' });
      }
      const callback = node.arguments[0];
      if (method === 'map' && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const parameter = callback.parameters[0]?.name;
        return target.map((value): Value => {
          if (value.t !== 'arr' || !parameter || !ts.isIdentifier(parameter)) return { t: 'unknown' };
          const scope = new Map(env).set(parameter.text, value.items);
          return { t: 'arr', items: returned(callback.body).flatMap((result) => next(result, scope)) };
        });
      }
    }
    return UNKNOWN;
  };

  /** Expressões devolvidas por um corpo de função (expressão direta ou `return` fora de funções internas). */
  const returned = (body: ts.ConciseBody): ts.Expression[] => {
    if (!ts.isBlock(body)) return [body];
    const results: ts.Expression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) results.push(node.expression);
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
    return results;
  };

  const methodValues = (name: string, depth: number): Values => {
    const owner = classOf();
    const method = owner && member(owner, name);
    if (!method || !(ts.isMethodDeclaration(method) || ts.isGetAccessor(method)) || !method.body) return UNKNOWN;
    const results = returned(method.body);
    return results.length ? results.flatMap((result) => evaluate(result, component.tsFile, new Map(), depth + 1)) : UNKNOWN;
  };

  /** Valores de `this.name`: inicializador e toda atribuição `this.name = …` da classe; getter vale pelo retorno. */
  const memberValues = (name: string, depth: number): Values => {
    const owner = classOf();
    const declared = owner && member(owner, name);
    if (!owner || !declared) return UNKNOWN;
    if (ts.isGetAccessor(declared) || ts.isMethodDeclaration(declared)) return methodValues(name, depth);
    if (!ts.isPropertyDeclaration(declared) || ts.getDecorators(declared)?.length || mutated(owner, name)) return UNKNOWN;
    const sources: ts.Expression[] = declared.initializer ? [declared.initializer] : [];
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && ts.isPropertyAccessExpression(node.left) && node.left.expression.kind === ts.SyntaxKind.ThisKeyword && node.left.name.text === name) {
        sources.push(node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? node.right : ts.factory.createIdentifier('__runtime__'));
      }
      ts.forEachChild(node, visit);
    };
    visit(owner);
    return sources.length ? sources.flatMap((source) => evaluate(source, component.tsFile, new Map(), depth + 1)) : UNKNOWN;
  };

  return (list, field) => {
    const [root, ...nested] = list.split('.');
    if (!root) return null;
    let items: Values = memberValues(root, 0).flatMap((value) => value.t === 'arr' ? value.items : UNKNOWN);
    for (const key of nested) {
      items = items.flatMap((value) => value.t === 'obj' ? value.p.get(key) ?? UNKNOWN : UNKNOWN).flatMap((value) => value.t === 'arr' ? value.items : UNKNOWN);
    }
    const labels = items.flatMap((value) => value.t === 'obj' ? value.p.get(field) ?? UNKNOWN : UNKNOWN);
    if (!labels.length || labels.some((value) => value.t !== 'str')) return null;
    return [...new Set(labels.map((value) => (value as { v: string }).v))];
  };
}
