/** @jest-environment jsdom */
import { tagTemplate, type TagContext } from '../../src/application/apply/tagger.js';
import type { ComponentDef } from '../../src/application/apply/ports/component-catalog.js';
import { DomEventTracker, installDomTracker } from '../../src/adapters/runtime/dom-tracker.js';
import { examplePreset } from '../fixtures/preset/index.js';
import type { TrackingEvent } from '../../src/config.js';

const actions = (template: string): ComponentDef => ({
  selectors: ['lib-actions'], source: 'library', template,
  outputs: new Map([['confirmar', 'confirmar'], ['cancelar', 'cancelar']]),
  inputs: new Set(), methods: new Map(), hostListeners: [],
});
const context = (def?: ComponentDef): TagContext => ({
  owner: 'app', relFile: 'src/page.html', funcionalidade: 'teste', tela: 'pagina',
  isScreen: false, usedIds: new Set(), catalog: { get: () => def },
});

describe('contrato entre prova estática e captura real', () => {
  it('distingue o handler da raiz de descendentes com a mesma tag', () => {
    const def = actions('<div (click)="confirmar.emit()"><button>Ok</button><div [innerHTML]="content"></div></div>');
    const result = tagTemplate('<lib-actions (confirmar)="save()"></lib-actions>', context(def));
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toContain('|click|:scope > div|');
    document.body.innerHTML = result.html;
    const host = document.querySelector('lib-actions')!;
    host.innerHTML = '<div><button>Ok</button><div>Conteúdo</div></div>';
    let id: string | undefined;
    const listener = (event: Event) => { id = DomEventTracker.resolveHit(event)?.id; };
    document.addEventListener('click', listener, true);
    try {
      host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      expect(id).toBe(result.entries[0]!.id);
    } finally { document.removeEventListener('click', listener, true); }
  });

  it('aceita elementos repetidos quando todos comprovam a mesma ação', () => {
    const def = actions('<button *ngIf="first" (click)="confirmar.emit()">Ok</button><button *ngIf="!first" (click)="confirmar.emit()">Ok</button>');
    const result = tagTemplate('<lib-actions (confirmar)="save()"></lib-actions>', context(def));
    expect(result.diagnostics).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.html).toContain('|click|button|');
  });

  it('cobertura no template filho evita marcação duplicada no pai', () => {
    const def = { ...actions('<form (ngSubmit)="confirmar.emit()"><button>Entrar</button></form>'), source: 'projeto' };
    const parent = tagTemplate('<lib-actions (confirmar)="save()"></lib-actions>', context(def));
    const child = tagTemplate(def.template, context());
    expect(parent.entries).toEqual([]);
    expect(parent.diagnostics).toEqual([]);
    expect(child.entries).toHaveLength(1);
    expect(child.html).toContain('data-at-event="submit"');
  });

  it('distingue dois botões irmãos sem classes ou IDs e captura Cancelar corretamente', () => {
    const def = actions('<button (click)="confirmar.emit()">Confirmar</button><button (click)="cancelar.emit()">Cancelar</button>');
    const result = tagTemplate('<lib-actions (confirmar)="save()" (cancelar)="cancel()"></lib-actions>', context(def));
    expect(result.diagnostics).toEqual([]);
    document.body.innerHTML = result.html;
    const host = document.querySelector('lib-actions')!;
    host.innerHTML = def.template;
    const hits: string[] = [];
    const listener = (event: Event) => { const hit = DomEventTracker.resolveHit(event); if (hit) hits.push(hit.id); };
    document.addEventListener('click', listener, true);
    try {
      host.children[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      expect(hits).toEqual([result.entries[1]!.id]);
    } finally { document.removeEventListener('click', listener, true); }
  });

  it('não transforma posição em prova em uma árvore condicional', () => {
    const def = actions('<button *ngIf="visible" (click)="confirmar.emit()">Confirmar</button><button (click)="cancelar.emit()">Cancelar</button>');
    const result = tagTemplate('<lib-actions (confirmar)="save()" (cancelar)="cancel()"></lib-actions>', context(def));
    expect(result.entries).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('repara IDs repetidos e mantém o reparo na segunda execução', () => {
    const html = '<button (click)="a()" data-at-id="igual">A</button><button (click)="b()" data-at-id="igual">B</button>';
    const first = tagTemplate(html, context());
    expect(first.entries.map((entry) => entry.id)).toEqual(['igual', 'igual-2']);
    const second = tagTemplate(first.html, context());
    expect(second.html).toBe(first.html);
    expect(second.entries.map((entry) => entry.id)).toEqual(['igual', 'igual-2']);
  });

  it('captura o cabeçalho Material uma vez, não a notificação opened ou o conteúdo', () => {
    const def: ComponentDef = {
      selectors: ['lib-accordion'], source: 'material', inputs: new Set(),
      outputs: new Map([['opened', 'opened'], ['closed', 'closed']]),
      methods: new Map([
        ['abriu', '{ this.opened.emit(); }'],
        ['fechou', '{ this.closed.emit(); }'],
      ]), hostListeners: [],
      template: '<mat-expansion-panel (opened)="abriu()" (closed)="fechou()"><mat-expansion-panel-header>Detalhes</mat-expansion-panel-header></mat-expansion-panel>',
    };
    const result = tagTemplate('<lib-accordion (opened)="a()" (closed)="b()"></lib-accordion>', context(def));
    expect(result.entries).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
    document.body.innerHTML = result.html;
    const host = document.querySelector('lib-accordion')!;
    host.innerHTML = '<mat-expansion-panel><mat-expansion-panel-header>Detalhes</mat-expansion-panel-header><div>Conteúdo</div></mat-expansion-panel>';
    const hits: string[] = [];
    const listener = (event: Event) => { const hit = DomEventTracker.resolveHit(event); if (hit) hits.push(hit.id); };
    document.addEventListener('click', listener, true);
    try {
      host.querySelector('mat-expansion-panel-header')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      host.querySelector('div')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      host.dispatchEvent(new Event('opened', { bubbles: true }));
      expect(hits).toEqual([result.entries[0]!.id]);
    } finally { document.removeEventListener('click', listener, true); }
  });

  it('paginationApi rastreia apenas links ativos, nunca reticências nem correção automática', () => {
    const def: ComponentDef = {
      selectors: ['lib-pagination'], source: 'ngx-pagination', inputs: new Set(),
      outputs: new Map([['pageChange', 'pageChange']]),
      methods: new Map([['onPageChange', '{ this.pageChange.emit(); }']]), hostListeners: [],
      template: `<pagination-template #p="paginationApi" (pageChange)="onPageChange($event)" (pageBoundsCorrection)="onPageChange($event)">
        <li [ngClass]="{'is-ellipsis': page.label === '...'}">
          <a tabindex="0" (click)="p.previous()">Anterior</a>
          <a tabindex="0" (click)="p.setCurrent(page.value)">Página</a>
          <a tabindex="0" (click)="p.next()">Próxima</a>
          <a tabindex="0">...</a>
        </li></pagination-template>`,
    };
    const result = tagTemplate('<lib-pagination (pageChange)="atualizar()"></lib-pagination>', context(def));
    expect(result.diagnostics).toEqual([]);
    expect(result.entries).toHaveLength(1);
    document.body.innerHTML = result.html;
    const host = document.querySelector('lib-pagination')!;
    host.innerHTML = '<li><a tabindex="0">Página 2</a></li><li class="is-ellipsis"><a tabindex="0">...</a></li>';
    const links = host.querySelectorAll('a');
    const hits: string[] = [];
    const listener = (event: Event) => { const hit = DomEventTracker.resolveHit(event); if (hit) hits.push(hit.id); };
    document.addEventListener('click', listener, true);
    try {
      links[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      links[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(hits).toEqual([result.entries[0]!.id]);
    } finally { document.removeEventListener('click', listener, true); }
  });

  it('atribui o clique do modal teleportado somente ao owner da projeção, sem duplicar', async () => {
    const wrapper: ComponentDef = {
      selectors: ['demo-modal-wrapper'], source: 'design-system',
      outputs: new Map([['onModalCloseButton', 'onModalCloseButton']]), inputs: new Set(),
      hostListeners: [], template: '<ng-template #wrapperModal><ng-content></ng-content></ng-template>',
      methods: new Map([['openModal', `{
        this.modalRef = await this.modalCtrl.create({component: DemoModalComponent, componentProps: {templateRef: this.wrapperModal, onModalCloseButton: new EventEmitter()}});
        this.modalRef.componentProps.onModalCloseButton.pipe(takeUntil(this.destroyed$)).subscribe(() => this.onModalCloseButton.emit());
      }`]]),
    };
    const modal: ComponentDef = {
      selectors: ['demo-modal'], source: 'design-system',
      outputs: new Map([['onModalCloseButton', 'onModalCloseButton']]), inputs: new Set(),
      hostListeners: [], methods: new Map([['closeModal', '{ this.onModalCloseButton.emit(); }']]),
      template: '<i data-testid="fechar" (click)="this.closeModal(\'Fechar\')"></i><a (click)="this.closeModal(\'Voltar\')">Voltar</a><button (click)="this.closeModal(\'Sair\')">Sair</button>',
    };
    const catalog = { get: (tag: string) => tag === 'demo-modal-wrapper' ? wrapper : tag === 'demo-modal' ? modal : undefined };
    const template = '<demo-modal-wrapper (onModalCloseButton)="fechar()"><div>Conteúdo projetado</div></demo-modal-wrapper>';
    const fed = tagTemplate(template, { ...context(), owner: 'mfe-exemplo', catalog });
    const mob = tagTemplate(template, { ...context(), owner: 'mob', catalog });
    expect(fed.diagnostics).toEqual([]);
    expect(fed.entries).toHaveLength(1);
    expect(fed.html).toContain('data-at-overlay-outputs=');
    expect(fed.html).toContain('data-at-owner="mfe-exemplo"');
    expect(tagTemplate(fed.html, { ...context(), owner: 'mfe-exemplo', catalog }).html).toBe(fed.html);

    document.body.innerHTML = `<section id="fed">${fed.html}</section><section id="mob">${mob.html}</section>`;
    const appendModal = (owner: string): HTMLElement => {
      const modalRoot = document.createElement('ion-modal');
      modalRoot.innerHTML = '<demo-modal><i data-testid="fechar" aria-label="Fechar modal"></i><p>Sem ação</p></demo-modal>';
      const source = document.querySelector(`#${owner} demo-modal-wrapper > div`)!;
      modalRoot.querySelector('demo-modal')!.appendChild(source);
      document.body.appendChild(modalRoot);
      return modalRoot;
    };
    const fedModal = appendModal('fed');
    const mobModal = appendModal('mob');
    const sentFed: TrackingEvent[] = [];
    const sentMob: TrackingEvent[] = [];
    const deps = (owner: string, sent: TrackingEvent[]) => ({
      owner, product: 'saude', schema: examplePreset.schema,
      resolveEnvironment: async () => 'app-x', send: (event: TrackingEvent) => { sent.push(event); }, warn: jest.fn(),
    });
    const stopFed = installDomTracker(document, deps('mfe-exemplo', sentFed));
    const stopMob = installDomTracker(document, deps('mob', sentMob));
    try {
      // Navegação atual diferente não altera owner/tela do overlay.
      document.documentElement.setAttribute('data-at-current-screen', 'outra|tela');
      fedModal.querySelector('i')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      mobModal.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sentFed).toHaveLength(1);
      expect(sentMob).toHaveLength(0);
      expect(sentFed[0]!.params['funcionalidade']).toBe('teste');
      expect(sentFed[0]!.params['tela']).toBe('app-x:saude:pagina');
      mobModal.querySelector('i')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sentFed).toHaveLength(1);
      expect(sentMob).toHaveLength(1);
      // Conteúdo com dois anchors é ambíguo: nunca atribuir owner por palpite.
      fedModal.querySelector('demo-modal')!.appendChild(fedModal.querySelector('[data-at-overlay-outputs]')!.cloneNode(true));
      fedModal.querySelector('i')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sentFed).toHaveLength(1);
    } finally { stopFed(); stopMob(); }
  });

  it('não transforma alteração de valor de campo de data em clique adicional', () => {
    const formCalendar: ComponentDef = {
      selectors: ['demo-form-calendar'], source: 'design-system',
      outputs: new Map([['onChangeDate', 'onChangeDate']]), inputs: new Set(),
      hostListeners: [], template: '<ion-select (click)="onClickAction()"></ion-select>',
      methods: new Map([['openSheet', '{ this.modalController.create({ componentProps: {onChangeDate: this.onChangeDate} }); this.setValue(data); }']]),
    };
    const catalog = { get: () => formCalendar };
    const formControl = tagTemplate('<demo-form-calendar formControlName="data" (onChangeDate)="guardar()"></demo-form-calendar>',
      { ...context(), catalog });
    expect(formControl.diagnostics).toEqual([]);
    expect(formControl.entries).toEqual([]);
    const other = tagTemplate('<demo-form-calendar (onChangeDate)="enviarAoServidor()"></demo-form-calendar>',
      { ...context(), catalog });
    expect(other.diagnostics).toEqual([]);
  });

  it('onSelectDate de calendário de formulário não rastreia o clique que apenas abre o sheet', () => {
    const calendar: ComponentDef = {
      selectors: ['custom-calendar'], source: 'design-system',
      outputs: new Map([['onSelectDate', 'onSelectDate']]), inputs: new Set(), hostListeners: [],
      template: '<ion-select (click)="onClickAction()"></ion-select>',
      methods: new Map([
        ['onClickAction', '{ this.openSheet(); }'],
        ['openSheet', `{
          const modal = await this.modalController.create({ component: DateSheetComponent });
          const {data, role} = await modal.onWillDismiss();
          if (role === 'confirm') {
            this.setValue(data);
            this.onSelectDate.emit(data);
          }
        }`],
      ]),
    };
    const result = tagTemplate('<custom-calendar formControlName="data" (onSelectDate)="atualizarFormulario($event)"></custom-calendar>',
      { ...context(), catalog: { get: () => calendar } });
    expect(result.diagnostics).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.html).not.toContain('data-at-outputs');
  });

  it('onChange herdado de setValue após confirmar data não vira clique na abertura', () => {
    const methods = new Map<string, string>([
      ['setValue', '{ this.value = value; this.onChange.emit({oldValue, value}); }'],
      ['adjustValue', '{ this.onChange.emit({value}); }'],
      ['writeValue', '{ this.onChange.emit({value}); }'],
      ['onClickAction', '{ this.openSheet(); }'],
      ['openSheet', `{
        const sheet = await this.modalController.create({component: CalendarSheetComponent});
        const {data, role} = await sheet.onWillDismiss();
        if (role === 'confirm') this.setValue(data);
      }`],
    ]);
    const component: ComponentDef = {
      selectors: ['ui-calendar'], source: 'design-system', outputs: new Map([['onChange', 'onChange']]),
      inputs: new Set(), hostListeners: [], methods,
      template: '<ion-select (click)="onClickAction()"></ion-select>',
    };
    const result = tagTemplate('<ui-calendar formControlName="data" (onChange)="atualizar($event)"></ui-calendar>',
      { ...context(), catalog: { get: () => component } });
    expect(result.diagnostics).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.html).not.toContain('data-at-outputs');

    // A confirmação de um select é um fluxo distinto; não classificá-lo pela tag ou pelo nome onChange.
    const select: ComponentDef = { ...component, selectors: ['ui-select'], methods: new Map([
      ...[...methods].filter(([name]) => name !== 'openSheet' && name !== 'onClickAction'),
      ['onClickAction', '{ this.openSelectSheetModal(); }'],
      ['openSelectSheetModal', `{
        const sheet = await this.modalController.create({});
        sheet.onDidDismiss().then(({ data }) => this.setValue(data.selectedOption.value));
      }`],
    ]) };
    const resultSelect = tagTemplate('<ui-select formControlName="opcao" (onChange)="selecionar()"></ui-select>',
      { ...context(), catalog: { get: () => select } });
    expect(resultSelect.entries).toHaveLength(1);
  });

  it('não confunde evento de sucesso do negócio com setValue do formulário', () => {
    const action: ComponentDef = {
      selectors: ['custom-form-action'], source: 'design-system',
      outputs: new Map([['concluido', 'concluido']]), inputs: new Set(), hostListeners: [],
      template: '<button (click)="abrir()">Salvar</button>',
      methods: new Map([['abrir', `{
        const result = await this.api.salvar();
        this.setValue(result);
        this.concluido.emit(result);
      }`]]),
    };
    const result = tagTemplate('<custom-form-action formControlName="texto" (concluido)="finalizar()"></custom-form-action>',
      { ...context(), catalog: { get: () => action } });
    expect(result.entries).toHaveLength(1);
  });

  it('reconcilia o tipo do evento quando o binding muda', () => {
    const result = tagTemplate('<form (ngSubmit)="entrar()" data-at-id="login" data-at-event="change"><button>Entrar</button></form>', context());
    expect(result.html).toContain('data-at-event="submit"');
    expect(result.html).not.toContain('data-at-event="change"');
  });

  it('captura submit por teclado sem taguear inputs nem extrair valores do formulário', async () => {
    const result = tagTemplate('<form (ngSubmit)="entrar()"><input value="segredo"><button type="submit">Entrar</button></form>', context());
    expect(result.entries).toHaveLength(1);
    document.body.innerHTML = result.html;
    expect(document.querySelector('input')!.hasAttribute('data-at-id')).toBe(false);
    const sent: TrackingEvent[] = [];
    const stop = installDomTracker(document, {
      owner: 'app', product: 'saude', schema: examplePreset.schema,
      resolveEnvironment: async () => 'app-x', send: (event) => { sent.push(event); }, warn: jest.fn(),
    });
    try {
      document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.params['rotulo']).toBe('entrar');
      expect(JSON.stringify(sent)).not.toContain('segredo');
    } finally { stop(); }
  });
});
