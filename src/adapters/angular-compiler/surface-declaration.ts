import ts from 'typescript';
import type { TrackingSurfaceDefinition } from '../../domain/contract/tracking-surface.js';
import type { SurfaceDeclaration } from '../../application/apply/ports/project-index.js';

/** Só aceita literais: o CLI nunca executa TypeScript do consumidor. */
function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => literal(item));
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) throw new Error('use propriedades literais');
      const key = property.name.getText().replace(/^['"]|['"]$/g, '');
      if (Object.hasOwn(result, key)) throw new Error('propriedade repetida na declaração');
      result[key] = literal(property.initializer);
    }
    return result;
  }
  throw new Error('use somente objetos, listas e textos literais');
}

export function surfaceFactoryNames(source: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== 'auto-tracking-angular') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      if ((item.propertyName ?? item.name).text === 'defineTrackingSurface') names.add(item.name.text);
    }
  }
  return names;
}

export function readSurfaceDeclaration(call: ts.CallExpression, source: ts.SourceFile): SurfaceDeclaration {
  const object = call.arguments[0];
  if (!object || !ts.isObjectLiteralExpression(object)) throw new Error('declare defineTrackingSurface com objeto literal');
  const value = literal(object) as TrackingSurfaceDefinition;
  const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const publicAttribute = (value: unknown): boolean => typeof value === 'string' && /^(?:aria-label|label|title|data-(?!at-)[a-z][a-z0-9-]*)$/.test(value);
  if (!text(value.id) || !Array.isArray(value.actions) || value.actions.length > 64
    || (value.ref !== undefined && typeof value.ref !== 'string')
    || value.actions.some((action) => !action || !text(action.id) || !text(action.selector) || !text(action.elemento)
      || !text(action.rotulo) || (action.event !== undefined && !['click', 'change', 'ionChange', 'submit'].includes(action.event))
      || (action.rotulos !== undefined && (!Array.isArray(action.rotulos) || !action.rotulos.length || action.rotulos.length > 64 || !action.rotulos.every(text)))
      || (action.allowedOptions !== undefined && (!Array.isArray(action.allowedOptions) || !action.allowedOptions.length || !action.allowedOptions.every(text)))
      || (action.optionAttribute !== undefined && !publicAttribute(action.optionAttribute))
      || (action.labelAttribute !== undefined && !publicAttribute(action.labelAttribute))
      || (action.optionPlaceholder !== undefined && (!action.optionAttribute || !/^\[[a-z][a-z0-9]*(?:-[a-z0-9]+)*\]$/.test(action.optionPlaceholder))))) {
    throw new Error('superfície exige id e ações literais válidas; opções exigem atributo público e placeholder semântico válido');
  }
  const ref = object.properties.find((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property) && property.name.getText().replace(/^['"]|['"]$/g, '') === 'ref');
  return { componentKey: `${source.fileName}#surface:${value.id}`, file: source.fileName,
    line: source.getLineAndCharacterOfPosition(object.getStart()).line + 1,
    text: object.getText(), definition: value,
    ...(ref ? { refStart: ref.initializer.getStart() - object.getStart(), refEnd: ref.initializer.getEnd() - object.getStart() } : {}),
  };
}
