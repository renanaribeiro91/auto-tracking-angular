import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { typeFields } from '../../src/application/apply/type-fields.js';
import { tagTemplate, type TagContext } from '../../src/application/apply/tagger.js';
import type { ComponentInfo } from '../../src/application/apply/ports/project-index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-type-fields-'));
const write = (rel: string, text: string): string => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
  return path.join(root, rel);
};
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

write('models/pessoa.ts', `export interface Base { id: string } export interface Pessoa extends Base { name: string; cpf: string; nascimento?: string }`);
write('models/index.ts', `export interface TipoDocumento { id: number; name: string; obrigatorio: boolean }`);
const tsFile = write('page/page.ts', `import { Pessoa } from '../models/pessoa';
  import { TipoDocumento } from '../models';
  type Selecao = { model: { model: { id: TipoDocumento } } };
  export class PageComponent {
    select: Selecao;
    beneficiario: Pessoa | null;
    tipos = signal<TipoDocumento[]>([]);
    titular = input.required<Pessoa>();
    solto: any;
    tipos$: Observable<TipoDocumento[]>;
    semTipo = {};
  }`);
const fields = typeFields({ tsFile, className: 'PageComponent' } as ComponentInfo);

describe('campos do tipo declarado de um caminho do componente', () => {
  it.each([
    ['caminho aninhado em type literal até interface importada pelo index', 'select.model.model.id', ['id', 'name', 'obrigatorio']],
    ['interface com extends e união com null', 'beneficiario', ['name', 'cpf', 'nascimento', 'id']],
    ['genérico de signal com array', 'tipos', ['id', 'name', 'obrigatorio']],
    ['input.required<T>()', 'titular', ['name', 'cpf', 'nascimento', 'id']],
    ['Observable de lista', 'tipos$', ['id', 'name', 'obrigatorio']],
  ])('%s', (_case, owner, expected) => {
    expect(fields(owner)).toEqual(expected);
  });

  it.each([['any', 'solto'], ['sem anotação', 'semTipo'], ['membro inexistente', 'outro'], ['campo de any', 'solto.x']])('%s: sem prova', (_case, owner) => {
    expect(fields(owner)).toBeNull();
  });
});

describe('dado pessoal decidido pelo tipo do dono', () => {
  const ctx = (typeFieldsOf: (owner: string) => readonly string[] | null): TagContext => ({
    owner: 'app', relFile: 'src/app/page/page.component.html', funcionalidade: 'x', tela: 'x', isScreen: false,
    catalog: { get: () => undefined }, usedIds: new Set(), mode: 'ref', typeFields: typeFieldsOf,
  });
  const button = (binding: string) => `<lib-doc [textoLabel]="${binding}" (click)="abrir()"></lib-doc>`;
  const dynamic = (html: string, typeFieldsOf: (owner: string) => readonly string[] | null) => tagTemplate(html, ctx(typeFieldsOf)).html.includes('data-at-label');

  it('nome de um tipo que não é pessoa é o texto do produto', () => {
    expect(dynamic(button('select.model.model.id.name'), (owner) => (owner === 'select.model.model.id' ? ['id', 'name', 'obrigatorio'] : null))).toBe(true);
  });

  it('nome de um tipo com documento ou nascimento é pessoa e nunca é lido', () => {
    expect(dynamic(button('select.model.model.id.name'), () => ['name', 'cpf'])).toBe(false);
    expect(dynamic(button('pessoa.apelido'), () => ['apelido', 'dataNascimento'])).toBe(false);
  });

  it('variável de laço é resolvida pela lista do componente, também lida de signal ou | async', () => {
    const seen: string[] = [];
    const html = `@for (tipo of tipos(); track tipo.id) { ${button('tipo.name')} }`;
    expect(dynamic(html, (owner) => { seen.push(owner); return ['id', 'name']; })).toBe(true);
    expect(dynamic(`<div *ngFor="let tipo of tipos$ | async">${button('tipo.name')}</div>`, (owner) => { seen.push(owner); return ['id', 'name']; })).toBe(true);
    expect(seen).toEqual(expect.arrayContaining(['tipos', 'tipos$']));
  });

  it('sem tipo declarado vale o significado das palavras: nome sem qualificador não é lido', () => {
    expect(dynamic(button('select.model.model.id.name'), () => null)).toBe(false);
    expect(dynamic(button('plano.nomePlano'), () => null)).toBe(true);
  });
});
