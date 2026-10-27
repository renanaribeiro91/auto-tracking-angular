// T15–T16 — índice AST do projeto: componentes (definição completa), templates, rotas, aberturas de modal e provider
import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { AngularComponentCatalogBuilder } from './component-catalog.js';
import type { ComponentDef } from '../../application/apply/ports/component-catalog.js';
import type { ComponentInfo, InlineTemplate, ProjectIndex, ServiceInfo } from '../../application/apply/ports/project-index.js';
import { PROJECT_INDEX_IGNORED_DIRECTORIES, TEST_DOUBLE_CLASS_PATTERN, TEST_DOUBLE_FILE_PATTERN, TEST_INFRASTRUCTURE_FILE_PATTERN } from './project-index.constants.js';
export type { ComponentInfo, InlineTemplate, ProjectIndex } from '../../application/apply/ports/project-index.js';

interface ClassRecord {
  readonly key: string;
  readonly file: string;
  readonly declaration: ts.ClassDeclaration;
  readonly className: string;
  readonly kind: 'component' | 'service';
}

interface ClassReference {
  readonly file: string;
  readonly className: string;
  readonly moduleSpecifier?: string;
}

/** Indexa componentes, rotas, serviços e providers Angular a partir dos arquivos TypeScript. */
export class AngularProjectIndexer {
  private readonly componentCatalogBuilder = new AngularComponentCatalogBuilder();

  listTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!PROJECT_INDEX_IGNORED_DIRECTORIES.has(entry.name)) out.push(...this.listTsFiles(full));
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.d.ts') &&
        !TEST_INFRASTRUCTURE_FILE_PATTERN.test(entry.name) &&
        !TEST_DOUBLE_FILE_PATTERN.test(entry.name)
      ) {
        out.push(full);
      }
    }
    return out.sort();
  }

  private decorator(node: ts.Node, name: string): ts.CallExpression | null {
    if (!ts.canHaveDecorators(node)) return null;
    for (const d of ts.getDecorators(node) ?? []) {
      const e = d.expression;
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === name) return e;
    }
    return null;
  }

  private literal(node: ts.Node | undefined): string | null {
    return node && ts.isStringLiteralLike(node) ? node.text : null;
  }

  private componentDef(cls: ts.ClassDeclaration, meta: ts.ObjectLiteralExpression, template: string): ComponentDef {
    const prop = (key: string) => meta.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === key);
    const outputs = new Map<string, string>();
    const inputs = new Set<string>();
    const methods = new Map<string, string>();
    const hostListeners: { event: string; expr: string }[] = [];

    for (const m of cls.members) {
      const name = m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : null;
      if (ts.isConstructorDeclaration(m) && m.body) methods.set('constructor', m.body.getText());
      if (!name) continue;
      const out = this.decorator(m, 'Output');
      if (out) outputs.set(this.literal(out.arguments[0]) ?? name, name);
      const inp = this.decorator(m, 'Input');
      if (inp) inputs.add(this.literal(inp.arguments[0]) ?? name);
      if (ts.isPropertyDeclaration(m) && m.initializer && ts.isCallExpression(m.initializer)) {
        const callee = m.initializer.expression.getText();
        // API de signals: output(), input(), model()
        if (callee === 'output') outputs.set(this.literal(this.objectAlias(m.initializer)) ?? name, name);
        if (callee === 'input' || callee === 'input.required' || callee === 'model') inputs.add(name);
        if (callee === 'model') outputs.set(`${name}Change`, name);
      }
      if ((ts.isMethodDeclaration(m) || ts.isGetAccessor(m)) && m.body) methods.set(name, m.body.getText());
      else if (ts.isPropertyDeclaration(m) && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
        methods.set(name, m.initializer.body.getText());
      }
      const hl = this.decorator(m, 'HostListener');
      if (hl && ts.isMethodDeclaration(m)) hostListeners.push({ event: this.literal(hl.arguments[0]) ?? '', expr: `${name}()` });
    }
    const host = prop('host')?.initializer;
    if (host && ts.isObjectLiteralExpression(host)) {
      for (const p of host.properties) {
        const key = ts.isPropertyAssignment(p) ? this.literal(p.name) ?? p.name.getText() : '';
        const event = /^\((.+)\)$/.exec(key)?.[1];
        if (event && ts.isPropertyAssignment(p)) hostListeners.push({ event, expr: this.literal(p.initializer) ?? '' });
      }
    }
    return {
          selectors: this.componentCatalogBuilder.elementSelectors(this.literal(prop('selector')?.initializer) ?? ''),
      source: 'projeto',
      outputs,
      inputs,
      template,
      methods,
      hostListeners,
    };
  }

  private objectAlias(call: ts.CallExpression): ts.Node | undefined {
    const opts = call.arguments[0];
    if (!opts || !ts.isObjectLiteralExpression(opts)) return undefined;
    const alias = opts.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'alias');
    return alias?.initializer;
  }

  private classKey(file: string, className: string): string {
    return `${path.resolve(file)}#${className}`;
  }

  private classMethods(declaration: ts.ClassDeclaration): Map<string, string> {
    const methods = new Map<string, string>();
    for (const member of declaration.members) {
      if (!member.name || !ts.isIdentifier(member.name)) continue;
      if ((ts.isMethodDeclaration(member) || ts.isGetAccessor(member)) && member.body) methods.set(member.name.text, member.body.getText());
      else if (ts.isPropertyDeclaration(member) && member.initializer) methods.set(member.name.text, member.initializer.getText());
    }
    return methods;
  }

  private injectionTypes(declaration: ts.ClassDeclaration): Map<string, string> {
    const result = new Map<string, string>();
    for (const member of declaration.members) {
      if (ts.isConstructorDeclaration(member)) {
        for (const parameter of member.parameters) {
          if (!ts.isIdentifier(parameter.name) || !parameter.type) continue;
          const propertyParameter = (ts.getModifiers(parameter) ?? []).some((modifier) =>
            modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword ||
            modifier.kind === ts.SyntaxKind.PublicKeyword || modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
          );
          if (!propertyParameter) continue;
          const token = this.typeName(parameter.type);
          if (token) result.set(parameter.name.text, token);
        }
      }
      if (!ts.isPropertyDeclaration(member) || !member.initializer || !ts.isIdentifier(member.name)) continue;
      if (!ts.isCallExpression(member.initializer) || member.initializer.expression.getText() !== 'inject') continue;
      const token = member.initializer.arguments[0];
      if (token && ts.isIdentifier(token)) result.set(member.name.text, token.text);
    }
    return result;
  }

  private typeName(node: ts.TypeNode): string | null {
    if (!ts.isTypeReferenceNode(node)) return null;
    const typeName = node.typeName;
    return ts.isIdentifier(typeName) ? typeName.text : typeName.right.text;
  }

  private importReferences(source: ts.SourceFile): ReadonlyMap<string, ClassReference> {
    const references = new Map<string, ClassReference>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const moduleSpecifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) references.set(clause.name.text, { file: source.fileName, className: 'default', moduleSpecifier });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          references.set(element.name.text, {
            file: source.fileName,
            className: element.propertyName?.text ?? element.name.text,
            moduleSpecifier,
          });
        }
      }
    }
    return references;
  }

  private resolveModuleFile(fromFile: string, specifier: string, sourceFiles: ReadonlyMap<string, ts.SourceFile>): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), specifier);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      const normalized = path.resolve(candidate);
      if (sourceFiles.has(normalized)) return normalized;
    }
    return null;
  }

  private resolveClass(
    reference: ClassReference,
    kind: ClassRecord['kind'],
    sourceFiles: ReadonlyMap<string, ts.SourceFile>,
    recordsByName: ReadonlyMap<string, readonly ClassRecord[]>,
    recordsByFile: ReadonlyMap<string, ReadonlyMap<string, ClassRecord>>,
  ): ClassRecord | null {
    const source = sourceFiles.get(path.resolve(reference.file));
    const imported = reference.moduleSpecifier ? this.resolveModuleFile(reference.file, reference.moduleSpecifier, sourceFiles) : null;
    const importRef = reference.moduleSpecifier ? reference : source && this.importReferences(source).get(reference.className);
    const targetFile = imported ?? (importRef?.moduleSpecifier ? this.resolveModuleFile(reference.file, importRef.moduleSpecifier, sourceFiles) : null);
    const targetName = importRef?.className ?? reference.className;
    if (targetFile) {
      const declarations = recordsByFile.get(targetFile);
      const exact = targetName === 'default'
        ? [...(declarations?.values() ?? [])].find((record) =>
            (ts.getModifiers(record.declaration) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
          )
        : declarations?.get(targetName);
      return exact?.kind === kind ? exact : null;
    }

    const local = recordsByFile.get(path.resolve(reference.file))?.get(reference.className);
    if (local?.kind === kind) return local;
    const matches = (recordsByName.get(reference.className) ?? []).filter((record) => record.kind === kind);
    return matches.length === 1 ? matches[0]! : null;
  }

  private componentReferencesIn(
    node: ts.Node,
    file: string,
    moduleSpecifier: string | undefined,
    sourceFiles: ReadonlyMap<string, ts.SourceFile>,
    recordsByName: ReadonlyMap<string, readonly ClassRecord[]>,
    recordsByFile: ReadonlyMap<string, ReadonlyMap<string, ClassRecord>>,
  ): Set<string> {
    const result = new Set<string>();
    const visit = (current: ts.Node): void => {
      if (ts.isIdentifier(current)) {
        const record = this.resolveClass({ file, className: current.text, ...(moduleSpecifier ? { moduleSpecifier } : {}) }, 'component', sourceFiles, recordsByName, recordsByFile);
        if (record) result.add(record.key);
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
    return result;
  }

  buildProjectIndex(scanRoot: string): ProjectIndex {
    const sourceFiles = new Map<string, ts.SourceFile>();
    for (const file of this.listTsFiles(scanRoot)) {
      const absolute = path.resolve(file);
      sourceFiles.set(absolute, ts.createSourceFile(absolute, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true));
    }

    const records: ClassRecord[] = [];
    for (const [file, source] of sourceFiles) {
      const collect = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) && node.name) {
          const componentMeta = this.decorator(node, 'Component')?.arguments[0];
          const isComponent = componentMeta && ts.isObjectLiteralExpression(componentMeta) && !TEST_DOUBLE_CLASS_PATTERN.test(node.name.text);
          const isService = !this.decorator(node, 'Component') && !this.decorator(node, 'NgModule');
          if (isComponent || isService) {
            records.push({
              key: this.classKey(file, node.name.text),
              file,
              declaration: node,
              className: node.name.text,
              kind: isComponent ? 'component' : 'service',
            });
          }
        }
        ts.forEachChild(node, collect);
      };
      collect(source);
    }

    const recordsByName = new Map<string, ClassRecord[]>();
    const recordsByFile = new Map<string, Map<string, ClassRecord>>();
    for (const record of records) {
      const sameName = recordsByName.get(record.className) ?? [];
      sameName.push(record);
      recordsByName.set(record.className, sameName);
      const sameFile = recordsByFile.get(record.file) ?? new Map<string, ClassRecord>();
      sameFile.set(record.className, record);
      recordsByFile.set(record.file, sameFile);
    }

    const componentRaw = new Map<string, { readonly info: ComponentInfo; readonly injections: ReadonlyMap<string, string> }>();
    const serviceRaw = new Map<string, { readonly record: ClassRecord; readonly methods: ReadonlyMap<string, string>; readonly injections: ReadonlyMap<string, string> }>();
    for (const record of records) {
      const declaration = record.declaration;
      if (record.kind === 'service') {
        serviceRaw.set(record.key, {
          record,
          methods: this.classMethods(declaration),
          injections: this.injectionTypes(declaration),
        });
        continue;
      }

      const meta = this.decorator(declaration, 'Component')?.arguments[0];
      if (!meta || !ts.isObjectLiteralExpression(meta)) continue;
      const source = sourceFiles.get(record.file)!;
      const prop = (key: string) => meta.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && item.name.getText() === key);
      const url = this.literal(prop('templateUrl')?.initializer);
      const templateFile = url ? path.resolve(path.dirname(record.file), url) : null;
      const templateProperty = prop('template');
      let inline: InlineTemplate | null = null;
      if (templateProperty && ts.isStringLiteralLike(templateProperty.initializer)) {
        const literal = templateProperty.initializer;
        inline = {
          start: literal.getStart() + 1,
          end: literal.getEnd() - 1,
          quote: source.text[literal.getStart()] as InlineTemplate['quote'],
          line: source.getLineAndCharacterOfPosition(literal.getStart()).line + 1,
        };
      }
      const template = templateFile && fs.existsSync(templateFile) ? fs.readFileSync(templateFile, 'utf-8') : inline ? source.text.slice(inline.start, inline.end) : '';
      componentRaw.set(record.key, {
        info: {
          key: record.key,
          className: record.className,
          tsFile: record.file,
          templateFile,
          inlineTemplate: templateProperty !== undefined,
          inline,
          def: this.componentDef(declaration, meta, template),
          classText: declaration.getText(),
          serviceDependencies: new Map(),
          methods: this.classMethods(declaration),
          referencedComponents: new Set(),
        },
        injections: this.injectionTypes(declaration),
      });
    }

    const resolveService = (file: string, className: string): ClassRecord | null =>
      this.resolveClass({ file, className }, 'service', sourceFiles, recordsByName, recordsByFile);
    const components: ComponentInfo[] = [...componentRaw.values()].map(({ info, injections }) => ({
      ...info,
      serviceDependencies: new Map([...injections].flatMap(([property, className]) => {
        const service = resolveService(info.tsFile, className);
        return service ? [[property, service.key] as const] : [];
      })),
      referencedComponents: new Set([...this.componentReferencesIn(
        recordsByFile.get(info.tsFile)!.get(info.className)!.declaration,
        info.tsFile,
        undefined,
        sourceFiles,
        recordsByName,
        recordsByFile,
      )].filter((key) => key !== info.key)),
    }));
    const services = new Map<string, ServiceInfo>();
    for (const [key, { record, methods, injections }] of serviceRaw) {
      const dependencies = new Map<string, string>();
      for (const [property, className] of injections) {
        const service = resolveService(record.file, className);
        if (service && service.key !== key) dependencies.set(property, service.key);
      }
      services.set(key, { key, className: record.className, tsFile: record.file, text: record.declaration.getText(), methods, dependencies, openedComponents: new Map() });
    }

    const routedComponents = new Set<string>();
    const ambiguousRoutes: { file: string; className: string; line: number }[] = [];
    const opens = new Map<string, Set<string>>();
    const rawServiceOpens = new Map<string, Map<string, Set<string>>>();
    let providerCalls = 0;
    for (const [file, source] of sourceFiles) {
      const resolveComponent = (className: string, moduleSpecifier?: string): ClassRecord | null =>
        this.resolveClass({ file, className, ...(moduleSpecifier ? { moduleSpecifier } : {}) }, 'component', sourceFiles, recordsByName, recordsByFile);
      const addRoute = (className: string, at: ts.Node, moduleSpecifier?: string): void => {
        const target = resolveComponent(className, moduleSpecifier);
        if (target) {
          routedComponents.add(target.key);
          return;
        }
        const candidates = (recordsByName.get(className) ?? []).filter((record) => record.kind === 'component');
        if (candidates.length < 2) return;
        const line = source.getLineAndCharacterOfPosition(at.getStart()).line + 1;
        if (!ambiguousRoutes.some((route) => route.file === file && route.className === className && route.line === line)) {
          ambiguousRoutes.push({ file, className, line });
        }
      };
      const visit = (node: ts.Node, owner: ClassRecord | null, methodName: string | null): void => {
        if (ts.isClassDeclaration(node) && node.name) {
          owner = recordsByFile.get(file)?.get(node.name.text) ?? null;
          methodName = null;
        } else if ((ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isPropertyDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
          methodName = node.name.text;
        }

        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'provideAutoTracking') {
          const arg = node.arguments[0];
          if (arg && ts.isPropertyAccessExpression(arg) && arg.name.text === 'runtime') providerCalls++;
        }

        if (ts.isObjectLiteralExpression(node)) {
          const properties = node.properties.filter(ts.isPropertyAssignment);
          const property = (name: string) => properties.find((item) => item.name.getText() === name)?.initializer;
          const component = property('component');
          const loadComponent = property('loadComponent');
          const isRoute = properties.some((item) => item.name.getText() === 'path') && (component !== undefined || loadComponent !== undefined);
          if (isRoute) {
            if (component && ts.isIdentifier(component)) {
              addRoute(component.text, component);
            }
            if (loadComponent) {
              const moduleSpecifier = this.dynamicImportSpecifier(loadComponent);
              for (const className of this.propertyNames(loadComponent)) {
                addRoute(className, loadComponent, moduleSpecifier ?? undefined);
              }
            }
          } else if (component && ts.isIdentifier(component) && owner) {
            const target = resolveComponent(component.text);
            if (target && owner.kind === 'component') {
              const opened = opens.get(owner.key) ?? new Set<string>();
              opened.add(target.key);
              opens.set(owner.key, opened);
            }
            if (target && owner.kind === 'service' && methodName) this.addServiceOpen(rawServiceOpens, owner.key, methodName, target.key);
          }
        }

        if (owner?.kind === 'service' && methodName && ts.isNewExpression(node)) {
          const references = node.arguments?.flatMap((argument) => [...this.componentReferencesIn(argument, file, undefined, sourceFiles, recordsByName, recordsByFile)]) ?? [];
          for (const target of references) this.addServiceOpen(rawServiceOpens, owner.key, methodName, target);
        }

        ts.forEachChild(node, (child) => visit(child, owner, methodName));
      };
      visit(source, null, null);
    }

    for (const [serviceKey, service] of services) {
      const openedComponents = rawServiceOpens.get(serviceKey) ?? new Map<string, Set<string>>();
      services.set(serviceKey, { ...service, openedComponents });
    }
    return { components, routedComponents, ambiguousRoutes, opens, services, providerCalls };
  }

  private addServiceOpen(
    opens: Map<string, Map<string, Set<string>>>,
    serviceKey: string,
    method: string,
    componentKey: string,
  ): void {
    const methods = opens.get(serviceKey) ?? new Map<string, Set<string>>();
    const components = methods.get(method) ?? new Set<string>();
    components.add(componentKey);
    methods.set(method, components);
    opens.set(serviceKey, methods);
  }

  private dynamicImportSpecifier(node: ts.Node): string | null {
    let specifier: string | null = null;
    const visit = (current: ts.Node): void => {
      if (ts.isCallExpression(current) && current.expression.kind === ts.SyntaxKind.ImportKeyword) {
        specifier = this.literal(current.arguments[0]);
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
    return specifier;
  }

  private propertyNames(node: ts.Node): string[] {
    const names = new Set<string>();
    const visit = (current: ts.Node): void => {
      if (ts.isPropertyAccessExpression(current) && (/^[A-Z]/.test(current.name.text) || current.name.text === 'default')) names.add(current.name.text);
      ts.forEachChild(current, visit);
    };
    visit(node);
    return [...names];
  }
}

const projectIndexer = new AngularProjectIndexer();
export const listTsFiles = (dir: string): string[] => projectIndexer.listTsFiles(dir);
export const buildProjectIndex = (scanRoot: string): ProjectIndex => projectIndexer.buildProjectIndex(scanRoot);
