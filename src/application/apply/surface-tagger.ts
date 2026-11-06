import { encodeTrackingToken } from '../../domain/contract/tracking-token-encoder.js';
import { slug } from '../../domain/contract/slug.js';
import type { SurfaceDeclaration } from './ports/project-index.js';
import type { ScreenIdentity } from './screen-identity-resolver.js';
import type { TagEntry } from './tagger.js';
import { trackingSurfaceContract } from '../../domain/contract/tracking-surface.js';
import ts from 'typescript';

/** Uma declaração sem uso conserva seu código, mas não uma ref fora da evidência. */
export function untagSurface(declaration: SurfaceDeclaration): string {
  if (declaration.refStart === undefined) return declaration.text;
  const source = ts.createSourceFile('surface.ts', `(${declaration.text})`, ts.ScriptTarget.Latest, true);
  const statement = source.statements[0];
  const expression = statement && ts.isExpressionStatement(statement) ? statement.expression : null;
  const object = expression && ts.isParenthesizedExpression(expression) ? expression.expression : null;
  if (!object || !ts.isObjectLiteralExpression(object)) return declaration.text;
  const property = object.properties.find((item) => ts.isPropertyAssignment(item)
    && item.name.getText(source).replace(/^['"]|['"]$/g, '') === 'ref');
  if (!property) return declaration.text;
  const start = property.getStart(source) - 1;
  let end = property.getEnd() - 1;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, declaration.text.slice(end));
  if (scanner.scan() === ts.SyntaxKind.CommaToken) end += scanner.getTextPos();
  return declaration.text.slice(0, start) + declaration.text.slice(end);
}

/** Mesmo token e mesmas linhas de evidência para uma declaração TypeScript e seu DOM. */
export function tagSurface(declaration: SurfaceDeclaration, owner: string, identity: ScreenIdentity,
  telas: readonly string[], arquivo: string, claimed: Set<string>): { text: string; entries: TagEntry[] } {
  const outputs = declaration.definition.actions.map((action) => ({
    id: `${slug(declaration.definition.id)}-${slug(action.id)}`, event: action.event ?? 'click',
    selector: action.selector, label: slug(action.rotulo), elemento: action.elemento, output: action.id,
  }));
  const ids = new Set<string>();
  for (const output of outputs) {
    if (claimed.has(output.id) || ids.has(output.id)) throw new Error(`ID duplicado: ${output.id}`);
    ids.add(output.id);
  }
  const rotulos = [...new Set(declaration.definition.actions.flatMap((action) => action.rotulos?.map((label) => slug(label)) ?? []))];
  const ref = encodeTrackingToken({ owner, ...identity, outputs, requireOrigin: true, surfaceContract: trackingSurfaceContract(declaration.definition),
    ...(rotulos.length ? { rotulos } : {}) });
  for (const id of ids) claimed.add(id);
  const text = declaration.refStart !== undefined && declaration.refEnd !== undefined
    ? declaration.text.slice(0, declaration.refStart) + JSON.stringify(ref) + declaration.text.slice(declaration.refEnd)
    : '{ ref: ' + JSON.stringify(ref) + ',' + declaration.text.slice(1);
  const entries: TagEntry[] = outputs.map((output, index) => ({ id: output.id, owner,
    evento: 'click', acao: 'clique', elemento: output.elemento, ...identity, telas,
    rotulo: declaration.definition.actions[index]!.labelAttribute ? '[rotulo-do-botao-exibido]' : output.label,
    origem: `${output.event} em superfície ${declaration.definition.id} (${output.selector})`,
    ...(declaration.definition.actions[index]!.rotulos ? { rotulos: declaration.definition.actions[index]!.rotulos!.map((label) => slug(label)) } : {}),
    arquivo, linha: declaration.line, ref,
    ...(['change', 'ionChange'].includes(output.event) || declaration.definition.actions[index]!.optionAttribute
      ? { opcao_selecionada_1: declaration.definition.actions[index]!.optionPlaceholder ?? '[valor-selecionado]' } : {}),
  }));
  return { text, entries };
}
