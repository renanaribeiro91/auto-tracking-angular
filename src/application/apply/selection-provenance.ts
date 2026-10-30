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
  return (list, property) => {
    if (!parsed) {
      parsed = true;
      declaration = ts.createSourceFile('component.ts', component.classText, ts.ScriptTarget.Latest, true).statements.find(ts.isClassDeclaration);
    }
    const member = declaration?.members.find((item): item is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(item) && ts.isIdentifier(item.name) && item.name.text === list);
    const initializer = member?.initializer && unwrap(member.initializer);
    if (!initializer || !ts.isArrayLiteralExpression(initializer) || initializer.elements.length === 0) return null;
    const values: string[] = [];
    for (const element of initializer.elements) {
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
