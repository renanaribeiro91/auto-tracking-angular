// Catálogo de componentes Angular (projeto + bibliotecas no formato Angular Package Format) e mapeamento
// de cada @Output até o gesto DOM interno que o dispara. Genérico: usa só metadata padrão do Angular.
import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import type { ComponentCatalog, ComponentDef } from '../../application/apply/ports/component-catalog.js';

/** Descobre componentes Angular usados no projeto e nos pacotes instalados. */
export class AngularComponentCatalogBuilder {
  /** Seletores de elemento de um `selector` Angular (ignora atributos e classes). */
  elementSelectors(selector: string): string[] {
    return selector
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /^[a-z][\w-]*-[\w-]*$/i.test(item))
      .map((item) => item.toLowerCase());
  }

  private literalText(node: ts.Node | undefined): string | null {
    return node && ts.isStringLiteralLike(node) ? node.text : null;
  }

  private objectProps(node: ts.Node | undefined): Map<string, ts.Expression> {
    const map = new Map<string, ts.Expression>();
    if (node && ts.isObjectLiteralExpression(node)) {
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p)) map.set(ts.isStringLiteralLike(p.name) ? p.name.text : p.name.getText(), p.initializer);
      }
    }
    return map;
  }

  private classMethods(cls: ts.ClassLikeDeclaration): Map<string, string> {
    const methods = new Map<string, string>();
    for (const m of cls.members) {
      const name = m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : ts.isConstructorDeclaration(m) ? 'constructor' : null;
      if (!name) continue;
      if ((ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessor(m)) && m.body) methods.set(name, m.body.getText());
      else if (ts.isPropertyDeclaration(m) && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
        methods.set(name, m.initializer.body.getText());
      }
    }
    return methods;
  }

  private parentClassName(cls: ts.ClassLikeDeclaration): string | null {
    const extendsClause = cls.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
    const expression = extendsClause?.types[0]?.expression;
    if (!expression) return null;
    return ts.isIdentifier(expression) ? expression.text : null;
  }

  private inheritedClassNames(typeName: string, classes: ReadonlyMap<string, ts.ClassLikeDeclaration>): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | null = typeName;
    while (current && !seen.has(current)) {
      seen.add(current);
      chain.unshift(current);
      current = classes.get(current) ? this.parentClassName(classes.get(current)!) : null;
    }
    return chain;
  }

  private metadataOutputs(properties: ReadonlyMap<string, ts.Expression>): Map<string, string> {
    const outputs = new Map<string, string>();
    for (const [prop, value] of this.objectProps(properties.get('outputs'))) {
      outputs.set(this.literalText(value) ?? prop, prop);
    }
    return outputs;
  }

  private metadataInputs(properties: ReadonlyMap<string, ts.Expression>): Set<string> {
    const inputs = new Set<string>();
    for (const [prop, value] of this.objectProps(properties.get('inputs'))) {
      const publicName = ts.isArrayLiteralExpression(value) ? value.elements[0] : value;
      inputs.add(this.literalText(publicName) ?? prop);
    }
    return inputs;
  }

/** Componentes de uma biblioteca APF: chamadas ɵɵngDeclareComponent com selector, inputs, outputs, template e host */
  private readPackageComponents(file: string, source: string, usedTags: ReadonlySet<string>): ComponentDef[] {
    const text = fs.readFileSync(file, 'utf-8');
    // parse (caro) só de arquivos que declaram algum seletor usado nos templates do projeto
    if (!text.includes('ngDeclareComponent') || ![...usedTags].some((tag) => new RegExp(`['\"]${tag}['\"]`).test(text))) return [];
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const classes = new Map<string, ts.ClassLikeDeclaration>();
    const declares = new Map<string, ts.ObjectLiteralExpression>();
    const visit = (n: ts.Node): void => {
      if ((ts.isClassDeclaration(n) || ts.isClassExpression(n)) && n.name) classes.set(n.name.text, n);
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
        const arg = n.arguments[0];
        if ((name === 'ɵɵngDeclareComponent' || name === 'ɵɵngDeclareDirective') && arg && ts.isObjectLiteralExpression(arg)) {
          const type = this.objectProps(arg).get('type');
          if (type && ts.isIdentifier(type)) declares.set(type.text, arg);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);

    const defs: ComponentDef[] = [];
    for (const decl of declares.values()) {
      const p = this.objectProps(decl);
      const selectors = this.elementSelectors(this.literalText(p.get('selector')) ?? '');
      if (selectors.length === 0) continue;
      const outputs = new Map<string, string>();
      const inputs = new Set<string>();
      const methods = new Map<string, string>();
      const hostListeners: { event: string; expr: string }[] = [];
      const type = p.get('type');
      const typeName = type && ts.isIdentifier(type) ? type.text : null;
      for (const className of typeName ? this.inheritedClassNames(typeName, classes) : []) {
        const inherited = declares.get(className);
        const inheritedProperties = inherited ? this.objectProps(inherited) : new Map<string, ts.Expression>();
        for (const [publicName, property] of this.metadataOutputs(inheritedProperties)) outputs.set(publicName, property);
        for (const input of this.metadataInputs(inheritedProperties)) inputs.add(input);
        for (const [event, expr] of this.objectProps(this.objectProps(inheritedProperties.get('host')).get('listeners'))) {
          hostListeners.push({ event, expr: this.literalText(expr) ?? '' });
        }
        const inheritedClass = classes.get(className);
        if (inheritedClass) for (const [method, body] of this.classMethods(inheritedClass)) methods.set(method, body);
      }
      defs.push({
        selectors,
        source,
        outputs,
        inputs,
        template: this.literalText(p.get('template')) ?? '',
        methods,
        hostListeners,
      });
    }
    return defs;
  }

/** CustomEvents de componentes Stencil são publicados no próprio host e atravessam Shadow DOM. */
  private readStencilComponents(dir: string, source: string, usedTags: ReadonlySet<string>): ComponentDef[] {
    const docsFile = path.join(dir, 'dist', 'docs.json');
    if (!fs.existsSync(docsFile)) return [];
    const docs = JSON.parse(fs.readFileSync(docsFile, 'utf8')) as {
      components?: { tag?: string; events?: { event?: string; bubbles?: boolean; composed?: boolean }[] }[];
    };
    const defs: ComponentDef[] = [];
    for (const component of docs.components ?? []) {
      const tag = component.tag?.toLowerCase();
      if (!tag || !usedTags.has(tag)) continue;
      const outputs = new Map<string, string>();
      const hostListeners: { event: string; expr: string }[] = [];
      for (const item of component.events ?? []) {
        const event = item.event;
        // O contrato publicado deve garantir que o CustomEvent alcance o listener no document.
        if (!event || !/^[A-Za-z][\w:-]*$/.test(event) || item.bubbles !== true || item.composed !== true) continue;
        outputs.set(event, event);
        hostListeners.push({ event, expr: `this.${event}.emit()` });
      }
      defs.push({ selectors: [tag], source, outputs, inputs: new Set(), template: '', methods: new Map(), hostListeners });
    }
    return defs;
  }

  /** Percorre dependências de runtime e peers instalados, inclusive transitivos e pacotes APF/Stencil. */
  private readDependencyComponents(consumerRoot: string, usedTags: ReadonlySet<string>): ComponentDef[] {
    const manifest = path.join(consumerRoot, 'package.json');
    if (!fs.existsSync(manifest)) return [];
    type PackageManifest = {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      module?: string;
      exports?: Record<string, unknown>;
    };
    const root = JSON.parse(fs.readFileSync(manifest, 'utf8')) as PackageManifest;
    const queue = Object.keys(root.dependencies ?? {}).map((name) => ({ name, from: consumerRoot }));
    const visited = new Set<string>();
    const defs: ComponentDef[] = [];

    const findInstalled = (name: string, from: string): string | null => {
      // Node resolve os módulos na árvore de ancestrais; não supõe node_modules achatado.
      let current = from;
      while (true) {
        const candidate = path.join(current, 'node_modules', name);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
        const parent = path.dirname(current);
        if (parent === current || !parent.startsWith(consumerRoot)) return null;
        current = parent;
      }
    };

    for (let i = 0; i < queue.length; i++) {
      const { name, from } = queue[i]!;
      if (name.startsWith('@angular/') || name.startsWith('@ionic/')) continue;
      const dir = findInstalled(name, from);
      if (!dir) continue;
      const realDir = fs.realpathSync(dir);
      if (visited.has(realDir)) continue;
      visited.add(realDir);
      const packageFile = path.join(dir, 'package.json');
      const pkg = fs.existsSync(packageFile) ? JSON.parse(fs.readFileSync(packageFile, 'utf8')) as PackageManifest : {};

      defs.push(...this.readStencilComponents(dir, name, usedTags));

      const bundles = new Set<string>();
      for (const folder of fs.readdirSync(dir).filter((entry) => /^fesm\d+$/.test(entry))) {
        for (const file of fs.readdirSync(path.join(dir, folder))) {
          if (/\.m?js$/.test(file)) bundles.add(path.join(dir, folder, file));
        }
      }
      if (pkg.module && !path.isAbsolute(pkg.module) && !pkg.module.split(/[\\/]/).includes('..')) bundles.add(path.join(dir, pkg.module));
      for (const bundle of bundles) {
        if (fs.existsSync(bundle) && fs.statSync(bundle).isFile()) {
          defs.push(...this.readPackageComponents(bundle, name, usedTags));
        }
      }

      for (const dependency of new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})])) {
        if (!dependency.startsWith('@angular/') && !dependency.startsWith('@ionic/')) {
          queue.push({ name: dependency, from: dir });
        }
      }
    }
    return defs;
  }

  buildCatalog(consumerRoot: string, projectDefs: readonly ComponentDef[]): ComponentCatalog {
    const usedTags = new Set<string>();
    for (const d of projectDefs) for (const m of d.template.matchAll(/<([a-z][\w]*-[\w-]*)/gi)) usedTags.add(m[1]!.toLowerCase());
    const byTag = new Map<string, ComponentDef[]>();
    // Um mesmo seletor pode ter implementações em módulos diferentes. Não perder produtores distintos.
    for (const def of [...this.readDependencyComponents(consumerRoot, usedTags), ...projectDefs]) {
      for (const selector of def.selectors) byTag.set(selector, [...(byTag.get(selector) ?? []), def]);
    }
    return {
      get: (tag, output) => {
        const candidates = byTag.get(tag.toLowerCase()) ?? [];
        if (!output) return candidates[candidates.length - 1];
        const producers = candidates.filter((candidate) => candidate.outputs.has(output));
        return producers.length === 1 ? producers[0] : candidates[candidates.length - 1];
      },
    };
  }
}

const componentCatalogBuilder = new AngularComponentCatalogBuilder();
export const elementSelectors = (selector: string): string[] => componentCatalogBuilder.elementSelectors(selector);
export const buildCatalog = (consumerRoot: string, projectDefs: readonly ComponentDef[]): ComponentCatalog =>
  componentCatalogBuilder.buildCatalog(consumerRoot, projectDefs);
