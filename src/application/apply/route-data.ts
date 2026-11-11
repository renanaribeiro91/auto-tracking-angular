import ts from 'typescript';
import { UNPROVEN_ROUTE_VALUE, type ComponentInfo, type RouteChain, type RouteValue } from './ports/project-index.js';
import { labelSlug } from '../../domain/contract/slug.js';
import { looksLikeIdentifier } from './tagger.constants.js';

/** Membro → caminho dentro do `data`; `*` quando a classe copia o `data` inteiro para si (`Object.assign(this, data)`). */
type Bindings = ReadonlyMap<string, readonly string[]> | '*';

/** Operadores que deixam o valor do `data` intacto; qualquer outro (map, switchMap…) tira a prova. */
const PASSTHROUGH_OPERATORS = new Set(['take', 'first', 'filter', 'takeUntil', 'takeUntilDestroyed', 'distinctUntilChanged', 'shareReplay', 'delay', 'debounceTime', 'observeOn']);
/** Valor inicial que não aparece como texto: o membro só ganha conteúdo pelo `data`. */
const EMPTY_INITIALIZER = /^(?:\[\s*\]|\{\s*\}|''|""|``|null|undefined)$/;

/**
 * Membros da página alimentados pelo `data` da rota, nas formas do Angular: `snapshot.data`, `data.subscribe` (com
 * `pipe` que não transforma o valor e parâmetro desestruturado), cópia inteira (`Object.assign(this, d)` ou
 * `for (const [k, v] of Object.entries(d)) this[k] = v`) e `@Input`/`input()` com `withComponentInputBinding`.
 */
export function routeDataBindings(component: ComponentInfo, inputBinding: boolean): { members: Bindings; written: ReadonlyMap<string, readonly ts.Expression[]>; initial: ReadonlyMap<string, string>; inputs: ReadonlySet<string> } | null {
  const declaration = ts.createSourceFile('component.ts', component.classText, ts.ScriptTarget.Latest, true).statements.find(ts.isClassDeclaration);
  if (!declaration) return null;
  const routeNames = new Set<string>();
  const isActivatedRoute = (type: ts.TypeNode | undefined, initializer?: ts.Expression) =>
    (!!type && ts.isTypeReferenceNode(type) && type.typeName.getText() === 'ActivatedRoute')
    || (!!initializer && ts.isCallExpression(initializer) && initializer.expression.getText() === 'inject' && initializer.arguments[0]?.getText() === 'ActivatedRoute');
  for (const member of declaration.members) {
    if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && isActivatedRoute(member.type, member.initializer)) routeNames.add(member.name.text);
    if (ts.isConstructorDeclaration(member)) for (const parameter of member.parameters) {
      if (ts.isIdentifier(parameter.name) && isActivatedRoute(parameter.type)) routeNames.add(parameter.name.text);
    }
  }
  const members = new Map<string, string[]>();
  const inputs = new Set<string>();
  const written = new Map<string, ts.Expression[]>();
  const initial = new Map<string, string>();
  let copiesAll = false;
  for (const member of declaration.members) {
    if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name)) continue;
    if (member.initializer) initial.set(member.name.text, member.initializer.getText());
    if (!inputBinding) continue;
    const input = ts.getDecorators(member)?.map((item) => item.expression).find((item): item is ts.CallExpression => ts.isCallExpression(item) && item.expression.getText() === 'Input');
    const alias = input?.arguments[0];
    if (input && (!alias || ts.isStringLiteralLike(alias))) { members.set(member.name.text, [alias && ts.isStringLiteralLike(alias) ? alias.text : member.name.text]); inputs.add(member.name.text); }
    if (member.initializer && ts.isCallExpression(member.initializer) && /^input(?:\.required)?$/.test(member.initializer.expression.getText())) {
      members.set(member.name.text, [member.name.text]);
      inputs.add(member.name.text);
      initial.delete(member.name.text);
    }
  }
  if (!routeNames.size && !members.size) return null;

  /** `this.route` ou `route` (parâmetro) apontando para a ActivatedRoute. */
  const isRoute = (node: ts.Expression): boolean => (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword && routeNames.has(node.name.text))
    || (ts.isIdentifier(node) && routeNames.has(node.text));
  /** Caminho no `data` de uma expressão: `route.snapshot.data.a.b`, `d.a` (d = valor emitido) ou nome desestruturado. */
  const dataPath = (node: ts.Expression, aliases: ReadonlyMap<string, readonly string[]>): string[] | null => {
    const keys: string[] = [];
    let current = node;
    while (!isRoute(current) && (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current) || ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current))) {
      if (ts.isPropertyAccessExpression(current)) keys.unshift(current.name.text);
      else if (ts.isElementAccessExpression(current)) {
        if (!ts.isStringLiteralLike(current.argumentExpression)) return null;
        keys.unshift(current.argumentExpression.text);
      }
      current = current.expression;
    }
    if (ts.isIdentifier(current) && aliases.has(current.text)) return [...aliases.get(current.text)!, ...keys];
    if (keys[0] === 'snapshot' && keys[1] === 'data' && isRoute(current)) return keys.slice(2);
    return null;
  };
  /** Valor emitido por `route.data` sem transformação: o observable direto ou com `pipe` só de operadores neutros. */
  const emitsData = (node: ts.Expression): boolean => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'data') return isRoute(node.expression);
    return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'pipe'
      && emitsData(node.expression.expression)
      && node.arguments.every((argument) => ts.isCallExpression(argument) && PASSTHROUGH_OPERATORS.has(argument.expression.getText()));
  };
  /** Nomes que valem `data` (ou parte dele) dentro de um callback de `subscribe`. */
  const callbackAliases = (callback: ts.Expression): Map<string, string[]> | null => {
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null;
    const parameter = callback.parameters[0]?.name;
    const aliases = new Map<string, string[]>();
    if (parameter && ts.isIdentifier(parameter)) aliases.set(parameter.text, []);
    if (parameter && ts.isObjectBindingPattern(parameter)) for (const element of parameter.elements) {
      if (!ts.isIdentifier(element.name) || element.dotDotDotToken) return null;
      const key = element.propertyName ? element.propertyName.getText() : element.name.text;
      aliases.set(element.name.text, [key]);
    }
    return aliases;
  };
  const isThis = (node: ts.Expression) => node.kind === ts.SyntaxKind.ThisKeyword;
  const visit = (node: ts.Node, aliases: ReadonlyMap<string, readonly string[]>): void => {
    let scope = aliases;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'subscribe' && emitsData(node.expression.expression) && node.arguments[0]) {
      scope = new Map([...aliases, ...(callbackAliases(node.arguments[0]) ?? [])]);
    }
    if (ts.isCallExpression(node) && node.expression.getText() === 'Object.assign' && node.arguments[0] && isThis(node.arguments[0])
      && node.arguments.slice(1).some((argument) => dataPath(argument, scope)?.length === 0)) copiesAll = true;
    if (ts.isForOfStatement(node) && ts.isCallExpression(node.expression) && node.expression.getText().startsWith('Object.entries(')
      && node.expression.arguments[0] && dataPath(node.expression.arguments[0], scope)?.length === 0 && ts.isVariableDeclarationList(node.initializer)) {
      const pattern = node.initializer.declarations[0]?.name;
      const [key, value] = pattern && ts.isArrayBindingPattern(pattern) ? pattern.elements.map((element) => ts.isBindingElement(element) && ts.isIdentifier(element.name) ? element.name.text : '') : [];
      const copies = (inner: ts.Node): boolean => (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isElementAccessExpression(inner.left) && isThis(inner.left.expression) && inner.left.argumentExpression.getText() === key && inner.right.getText() === value)
        || !!ts.forEachChild(inner, (child) => copies(child) || undefined);
      if (key && value && copies(node.statement)) copiesAll = true;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      && ts.isPropertyAccessExpression(node.left) && isThis(node.left.expression)) {
      const name = node.left.name.text;
      const path = node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? dataPath(node.right, scope) : null;
      if (path) members.set(name, path);
      else written.set(name, [...(written.get(name) ?? []), node.right]);
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  };
  // Alias local do snapshot (`const data = this.route.snapshot.data`, `const { x } = …`) vale para a classe inteira.
  const locals = new Map<string, string[]>();
  const collectLocals = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const path = dataPath(node.initializer, locals);
      if (path && ts.isIdentifier(node.name)) locals.set(node.name.text, path);
      if (path && ts.isObjectBindingPattern(node.name)) for (const element of node.name.elements) {
        if (ts.isIdentifier(element.name) && !element.dotDotDotToken) locals.set(element.name.text, [...path, element.propertyName ? element.propertyName.getText() : element.name.text]);
      }
    }
    ts.forEachChild(node, collectLocals);
  };
  collectLocals(declaration);
  visit(declaration, locals);
  return { members: copiesAll ? '*' : members, written, initial, inputs };
}

/** Valor de `path` no `data` da rota; ausente é `undefined` (o membro fica com o valor inicial). */
function valueAt(data: Readonly<Record<string, RouteValue>>, path: readonly string[]): RouteValue | undefined {
  let current: RouteValue | undefined = data;
  for (const key of path) {
    if (current === UNPROVEN_ROUTE_VALUE) return UNPROVEN_ROUTE_VALUE;
    current = current !== null && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, RouteValue>)[key] : undefined;
  }
  return current;
}

/**
 * Textos de `member` (com `field` em cada item quando é lista) em cada rota que renderiza a página: padrão da rota →
 * rótulos. `null` quando qualquer rota não prova o valor, quando o membro também recebe valor de outra fonte ou quando
 * a página não é só roteada; então o runtime continua lendo o texto exibido.
 */
export function routeDataLabels(component: ComponentInfo, chains: readonly RouteChain[], inputBinding: boolean, onlyRouted: boolean):
  (member: string, field?: string) => ReadonlyMap<string, readonly string[]> | null {
  let bindings: ReturnType<typeof routeDataBindings> | undefined;
  return (member, field) => {
    if (!onlyRouted || !chains.length) return null;
    bindings ??= routeDataBindings(component, inputBinding);
    if (!bindings) return null;
    const path = bindings.members === '*' ? [member] : bindings.members.get(member);
    const initial = bindings.initial.get(member);
    if (!path || bindings.written.has(member) || (initial !== undefined && !EMPTY_INITIALIZER.test(initial))) return null;
    const result = new Map<string, string[]>();
    for (const chain of chains) {
      if (chain.data === null) return null;
      const value = valueAt(chain.data ?? {}, path);
      // Input ligado pelo router sem a chave no `data` recebe parâmetro de caminho ou de query: valor da URL, não prova.
      if (value === undefined && bindings.inputs.has(member)) return null;
      if (value === undefined) { result.set(chain.pattern, []); continue; }
      const texts = (field === undefined ? [value] : Array.isArray(value) ? value.map((item) => valueAt(
        item !== null && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, RouteValue> : { [field]: UNPROVEN_ROUTE_VALUE }, [field])) : [UNPROVEN_ROUTE_VALUE]);
      // Chave de código no lugar de texto (`btn-salvar`, `menu.titulo`) não é o que a pessoa lê: o runtime continua lendo a tela.
      if (texts.some((text) => typeof text !== 'string' || looksLikeIdentifier(text))) return null;
      result.set(chain.pattern, [...new Set((texts as string[]).map((text) => labelSlug(text)).filter(Boolean))]);
    }
    return result;
  };
}
