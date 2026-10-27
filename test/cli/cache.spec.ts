import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { decodeTrackingToken } from '../../src/domain/contract/tracking-token.js';

describe('CLI: cache conserva prova e status', () => {
  let root: string;
  const write = (file: string, content: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const cli = (command = 'apply') => {
    const result = spawnSync(process.execPath, [path.resolve('dist/cli/index.js'), command, '--root', root, '--json'], { encoding: 'utf8' });
    if (!result.stdout.trim()) throw new Error(result.stderr || String(result.error));
    return { exit: result.status, ...JSON.parse(result.stdout) };
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracking-cache-'));
    write('angular.json', JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
    write('tsconfig.app.json', '{}');
    write('package.json', JSON.stringify({ dependencies: { 'lib-ui': '1.0.0' } }));
    write('auto-tracking.config.ts', `export default defineAutoTrackingProject({
      projects: [{ angularProject: 'app', tsconfig: 'tsconfig.app.json' }],
      runtime: { owner: 'app', root: 'app-root', product: 'saude', preset: examplePreset, mode: 'ref', send: () => {} }
    });`);
    write('src/app.ts', `@Component({selector: 'app-root', templateUrl: './app.html'}) export class App {}
      const routes = [{ path: '', component: App }]; const providers = [provideAutoTracking(config.runtime)];`);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reanalisa alterações nas marcações e preserva um ID existente explícito', () => {
    write('src/app.html', '<button (click)="salvar()">Salvar</button>');
    expect(cli().status).toBe('valid');
    expect(cli().cache).toBe('hit');
    const file = path.join(root, 'src/app.html');
    const original = fs.readFileSync(file, 'utf8');
    const ref = /data-at-ref="([^"]+)"/.exec(original)![1]!;
    const reportFile = path.join(root, '.auto-tracking/relatorio.json');
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const preservedId = decodeTrackingToken(ref)?.click?.id;
    expect(preservedId).toBeTruthy();
    // O HTML não carrega mais metadados estáticos, somente a referência.
    fs.writeFileSync(file, original.replace(ref, 'e-referenciainvalida'));
    expect(cli('verify').status).toBe('incomplete');
    fs.writeFileSync(file, original);
    expect(cli().status).toBe('valid');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(decodeTrackingToken(ref)?.click?.id).toBe(preservedId);
    expect(cli()).toMatchObject({ status: 'valid', arquivosEscritos: 0, cache: 'hit' });
  });

  it('modo classic preserva atributos originais e relatório sem ref', () => {
    const config = path.join(root, 'auto-tracking.config.ts');
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace("mode: 'ref'", "mode: 'classic'"));
    write('src/app.html', '<button (click)="salvar()">Salvar</button>');
    const result = cli();
    expect(result).toMatchObject({ status: 'valid', exit: 0 });
    const html = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
    expect(html).toContain('data-at-id=');
    expect(html).toContain('data-at-owner="app"');
    expect(html).not.toContain('data-at-ref=');
    const report = JSON.parse(fs.readFileSync(path.join(root, '.auto-tracking/relatorio.json'), 'utf8'));
    expect(report.entries.length).toBeGreaterThan(0);
    expect(report.entries.every((entry: { ref?: string }) => entry.ref === undefined)).toBe(true);
    expect(cli()).toMatchObject({ status: 'valid', arquivosEscritos: 0 });
  });

  it('um aviso mantém o mesmo status com e sem cache', () => {
    write('src/app.html', '<button (click)="avancar()">Voltar</button>');
    const first = cli();
    expect(first.status).toBe('valid');
    expect(first.diagnosticos).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'VISIBLE_LABEL_BEHAVIOR_CONFLICT' })]));
    const second = cli();
    expect(second).toMatchObject({ status: first.status, exit: first.exit, arquivosEscritos: 0, cache: 'hit' });
  });

  it('branding vazio desativa a identidade de compatibilidade do preset', async () => {
    const file = path.join(root, 'auto-tracking.config.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('projects:', 'branding: {}, projects:'));
    write('src/app.html', '<button (click)="salvar()">Salvar</button>');
    expect(cli().status).toBe('valid');
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(root, '.auto-tracking/evidencia-tagueamento.xlsx'));
    expect(workbook.getWorksheet('Resumo')?.getCell('B1').font.color?.argb).toBe('FF284B63');
    expect(workbook.model.media).toHaveLength(0);
    expect(cli()).toMatchObject({ status: 'valid', arquivosEscritos: 0, cache: 'hit' });
  });

  it('rejeita cor inválida antes de escrever marcações', () => {
    const file = path.join(root, 'auto-tracking.config.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('projects:', "branding: { primaryColor: 'errada' }, projects:"));
    const html = '<button (click)="salvar()">Salvar</button>';
    write('src/app.html', html);
    const result = cli();
    expect(result.exit).toBe(2);
    expect(fs.readFileSync(path.join(root, 'src/app.html'), 'utf8')).toBe(html);
  });

  it('recompõe o mapeamento de output adulterado ou removido', () => {
    write('src/app.html', '<lib-ui (ok)="save()"></lib-ui>');
    write('node_modules/lib-ui/fesm2022/lib-ui.mjs', `class LibUi { go() { this.ok.emit(); } }
      LibUi.ɵcmp = i0.ɵɵngDeclareComponent({type: LibUi, selector: 'lib-ui', outputs: {ok: 'ok'},
      template: '<button id="real" (click)="go()">Ok</button>'});`);
    expect(cli().status).toBe('valid');
    const file = path.join(root, 'src/app.html');
    const original = fs.readFileSync(file, 'utf8');
    expect(original).toMatch(/data-at-ref="v1\.[A-Za-z0-9_-]+"/);
    const manifestFile = path.join(root, '.auto-tracking/relatorio.json');
    const report = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const ref = /data-at-ref="([^"]+)"/.exec(original)![1]!;
    expect(decodeTrackingToken(ref)?.outputs?.[0]?.selector).toBe('#real');
    fs.writeFileSync(file, original.replace(ref, 'v1.invalido'));
    expect(cli('verify').status).toBe('incomplete');
    // Não inventar um novo ID quando falta a referência: restaurar o valor válido.
    fs.writeFileSync(file, original);
    expect(cli().status).toBe('valid');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/ data-at-ref="[^"]+"/, ''));
    expect(cli('verify').status).toBe('incomplete');
    expect(cli().status).toBe('valid');
    expect(fs.readFileSync(file, 'utf8')).toMatch(/data-at-ref="v1\.[A-Za-z0-9_-]+"/);
    expect(cli()).toMatchObject({ status: 'valid', arquivosEscritos: 0, cache: 'hit' });
  });

  it('recalcula quando binding de output muda e remove marcação obsoleta', () => {
    write('src/app.html', '<lib-ui (ok)="save()"></lib-ui>');
    write('node_modules/lib-ui/fesm2022/lib-ui.mjs', `class LibUi { go() { this.ok.emit(); } }
      LibUi.ɵcmp = i0.ɵɵngDeclareComponent({type: LibUi, selector: 'lib-ui', outputs: {ok: 'ok'},
      template: '<button id="real" (click)="go()">Ok</button>'});`);
    expect(cli().status).toBe('valid');
    const file = path.join(root, 'src/app.html');
    let html = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, html.replace('(ok)="save()"', '(naoExiste)="save()"'));
    expect(cli('verify')).toMatchObject({ status: 'incomplete', exit: 1 });
    const changed = cli();
    expect(changed.status).toBe('valid');
    expect(changed.diagnosticos).toBe(0);
    html = fs.readFileSync(file, 'utf8');
    const newRef = /data-at-ref="([^"]+)"/.exec(html)?.[1];
    const descriptor = newRef ? decodeTrackingToken(newRef) : undefined;
    expect(descriptor?.outputs).toBeUndefined();
    fs.writeFileSync(file, html.replace('(naoExiste)="save()"', '(ok)="save()"'));
    expect(cli('verify')).toMatchObject({ status: 'incomplete', exit: 1 });
    expect(cli().status).toBe('valid');
    expect(fs.readFileSync(file, 'utf8')).toMatch(/data-at-ref="v1\.[A-Za-z0-9_-]+"/);
    expect(cli()).toMatchObject({ status: 'valid', arquivosEscritos: 0, cache: 'hit' });
  });

  it('reanalisa um bundle instalado alterado sem mudança de lockfile', () => {
    write('src/app.html', '<lib-ui (ok)="save()"></lib-ui>');
    const bundle = (id: string) => `class LibUi { go() { this.ok.emit(); } }
      LibUi.ɵcmp = i0.ɵɵngDeclareComponent({type: LibUi, selector: 'lib-ui', outputs: {ok: 'ok'},
      template: '<button id="${id}" (click)="go()">Ok</button>'});`;
    write('node_modules/lib-ui/fesm2022/lib-ui.mjs', bundle('before'));
    expect(cli().status).toBe('valid');
    expect(cli().cache).toBe('hit');
    write('node_modules/lib-ui/fesm2022/lib-ui.mjs', bundle('after'));
    expect(cli('verify')).toMatchObject({ status: 'incomplete', exit: 1 });
    const updated = cli();
    expect(updated.status).toBe('valid');
    const html = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
    const ref = /data-at-ref="([^"]+)"/.exec(html)![1]!;
    const report = JSON.parse(fs.readFileSync(path.join(root, '.auto-tracking/relatorio.json'), 'utf8'));
    expect(decodeTrackingToken(ref)?.outputs?.[0]?.selector).toBe('#after');
    expect(cli()).toMatchObject({ status: 'valid', arquivosEscritos: 0, cache: 'hit' });
  });
});
