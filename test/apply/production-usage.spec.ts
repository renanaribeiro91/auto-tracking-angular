import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AngularProjectIndexer } from '../../src/adapters/angular-compiler/project-index.js';
import { resolveProductionUsage } from '../../src/application/apply/production-usage.js';

describe('escopo de produção do tracking', () => {
  let root: string;
  const write = (name: string, source: string) => fs.writeFileSync(path.join(root, name), source);
  const surface = (id: string) => `defineTrackingSurface({id:'${id}',actions:[{id:'fechar',selector:'button',elemento:'botao',rotulo:'Fechar'}]})`;
  const inspect = () => {
    const index = new AngularProjectIndexer().buildProjectIndex(root);
    const usage = resolveProductionUsage(index, 'app-root');
    const surfaces = index.surfaces!.filter((item) => usage.surfaces.has(item.componentKey)).map((item) => item.definition.id).sort();
    const components = index.components.filter((item) => usage.components.has(item.key)).map((item) => item.className);
    return { index, usage, surfaces, components };
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-production-usage-'));
    write('routes.ts', `import { Page } from './page'; export const routes = [{path:'page',component:Page}];`);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('segue apenas métodos chamados pelo template e componentes renderizados', () => {
    write('page.ts', `import { Modals } from './modals';
      @Component({selector:'app-page',template:'<used-child></used-child><button id="dead" title="dead" (click)="open()">dead</button>'})
      export class Page { constructor(private modals:Modals){} open(){this.modals.used();} dead(){this.modals.dead();} }
      @Component({selector:'used-child',template:'<button>Usado</button>'}) export class UsedChild {}
      @Component({selector:'unused-child',template:'<button>Não usado</button>'}) export class UnusedChild {}`);
    write('modals.ts', `import {defineTrackingSurface} from 'auto-tracking-angular'; export class Modals {
      used(){return ${surface('used')};} dead(){return ${surface('dead')};} }`);
    const result = inspect();
    expect(result.surfaces).toEqual(['used']);
    expect(result.components).toEqual(expect.arrayContaining(['Page', 'UsedChild']));
    expect(result.components).not.toContain('UnusedChild');
    expect(result.usage.diagnostics).toEqual([]);
  });

  it('preserva contratos dinâmicos nomeados em dados do dispatcher, sem usar textos não relacionados', () => {
    write('page.ts', `import { Auth } from './modals'; @Component({selector:'app-page',template:'<button (click)="login()">Entrar</button>'})
      export class Page { constructor(private auth:Auth){} login(){this.auth.login();} }`);
    write('modals.ts', `import {defineTrackingSurface} from 'auto-tracking-angular';
      export class Auth { constructor(private callbacks:Callbacks){} login(){this.callbacks[error.callback](error);} }
      export class Callbacks { valid(){return ${surface('valid')};} unused(){return ${surface('unused')};} }`);
    write('responses.ts', `export const response = [{callback:'valid',message:'unused'}];`);
    expect(inspect().surfaces).toEqual(['valid']);
    expect(inspect().usage.diagnostics).toEqual([]);
  });

  it('segue herança, dependências, métodos privados e ciclos sem ativar o método morto', () => {
    write('page.ts', `import { Base } from './modals'; @Component({selector:'app-page',template:'<button (click)="open()">Abrir</button>'})
      export class Page extends Base {}`);
    write('modals.ts', `import {defineTrackingSurface} from 'auto-tracking-angular';
      export class Base { constructor(private first:First){} open(){this.first.open();} }
      export class First { constructor(private second:Second){} open(){this.privateOpen();} privateOpen(){this.second.open();} dead(){return ${surface('dead')};} }
      export class Second { constructor(private first:First){} open(){this.first.open(); return ${surface('inherited')};} }`);
    expect(inspect().surfaces).toEqual(['inherited']);
  });

  it('analisa construtor e inicialização efetiva, mas não executa corpo de função apenas declarada', () => {
    write('page.ts', `import {Modals} from './modals'; @Component({selector:'app-root',template:'<main></main>'})
      export class Page { constructor(private modals:Modals){this.modals.ready();} }`);
    write('modals.ts', `import {defineTrackingSurface} from 'auto-tracking-angular'; export class Modals {
      setup = this.initialize(); callback = () => this.unused();
      initialize(){return ${surface('initialize')};} ready(){return ${surface('ready')};} unused(){return ${surface('unused')};} }`);
    expect(inspect().surfaces).toEqual(['initialize', 'ready']);
  });

  it('segue effects pela action realmente despachada, incluindo transição de erro', () => {
    write('page.ts', `import * as Action from './actions'; @Component({selector:'app-page',template:'<button (click)="load()">Carregar</button>'})
      export class Page { load(){this.store.dispatch(Action.load());} }`);
    write('actions.ts', `export const load=()=>({}); export const fail=()=>({}); export const unused=()=>({});`);
    write('modals.ts', `import * as Events from './actions'; import {defineTrackingSurface} from 'auto-tracking-angular';
      export class Effects { constructor(private modal:Modals){}
        load$ = createEffect(()=>this.actions.pipe(ofType(Events.load),switchMap(()=>of(Events.fail()))));
        fail$ = createEffect(()=>this.actions.pipe(ofType(Events.fail),tap(()=>this.modal.used())),{dispatch:false});
        dead$ = createEffect(()=>this.actions.pipe(ofType(Events.unused),tap(()=>this.modal.dead())),{dispatch:false}); }
      export class Modals { used(){return ${surface('used')};} dead(){return ${surface('dead')};} }`);
    write('effect-registration.ts', `import {Effects} from './modals'; export const providers = [provideEffects(Effects)];`);
    expect(inspect().surfaces).toEqual(['used']);
  });

  it('não considera effect sem registro parte da aplicação e suporta controle/interpolação Angular', () => {
    write('page.ts', `import * as Action from './actions'; @Component({selector:'app-page',template:'@if (visible()) { <p>{{title()}}</p> }'})
      export class Page { visible(){this.store.dispatch(Action.load());return true;} title(){return 'Título';} dead(){this.store.dispatch(Action.unused());} }`);
    write('actions.ts', `export const load=()=>({}); export const unused=()=>({});`);
    write('modals.ts', `import * as Action from './actions';import {defineTrackingSurface} from 'auto-tracking-angular';
      export class Effects { active$=createEffect(()=>this.actions.pipe(ofType(Action.load),tap(()=>${surface('unregistered')}))); }`);
    expect(inspect().surfaces).toEqual([]);
    write('registration.ts', `import {Effects} from './modals';export const providers=[provideEffects(Effects)];`);
    expect(inspect().surfaces).toEqual(['unregistered']);
  });

  it('não aprova dispatcher desconhecido capaz de abrir superfície e ignora coleção sem tracking', () => {
    write('page.ts', `import {Modals,Collection} from './modals'; @Component({selector:'app-page',template:'<button (click)="open()">Abrir</button>'})
      export class Page { constructor(private modals:Modals, private collection:Collection){} open(){this.modals[server.method]();this.collection[server.method]();} }`);
    write('modals.ts', `import {defineTrackingSurface} from 'auto-tracking-angular'; export class Modals { open(){return ${surface('open')};} }
      export class Collection { choose(){} }`);
    const result = inspect();
    expect(result.surfaces).toEqual([]);
    expect(result.usage.diagnostics).toHaveLength(1);
    expect(result.usage.diagnostics[0]?.code).toBe('TRACKING_DYNAMIC_USAGE_UNPROVEN');
  });
});
