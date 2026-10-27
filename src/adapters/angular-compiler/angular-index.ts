// T15 — leitura estática de auto-tracking.config.ts (parse sintático, nunca executa) e do angular.json

import ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import type { AngularWorkspace, ProjectConfig, StaticTrackingConfig } from '../../application/apply/ports/tracking-project-config.js';
export type { AngularWorkspace, ProjectConfig, StaticTrackingConfig } from '../../application/apply/ports/tracking-project-config.js';

/** Lê as configurações estáticas do consumidor e do workspace Angular. */
export class AngularProjectConfigReader {
  readTrackingConfigStatically(configFile: string): StaticTrackingConfig | null {
    if (!fs.existsSync(configFile)) return null;

    // somente parse sintático: os imports do consumidor (serviços Angular) não são resolvidos nem executados
    const sourceFile = ts.createSourceFile(configFile, fs.readFileSync(configFile, 'utf-8'), ts.ScriptTarget.Latest, true);
    const result = this.extractConfigFromSourceFile(sourceFile);
    if (!result) return null;

    return { ...result, configFile };
  }

  private extractConfigFromSourceFile(
  sourceFile: ts.SourceFile,
): Omit<StaticTrackingConfig, 'configFile'> | null {
    let config: Omit<StaticTrackingConfig, 'configFile'> | null = null;

    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isExportAssignment(node)) return;
      const expr = node.expression;
      // defineAutoTrackingProject({...})
      if (!ts.isCallExpression(expr)) return;
      const arg = expr.arguments[0];
      if (!arg || !ts.isObjectLiteralExpression(arg)) return;
      config = this.extractFromObjectLiteral(arg);
    });

    return config;
  }

  private extractFromObjectLiteral(
  obj: ts.ObjectLiteralExpression,
): Omit<StaticTrackingConfig, 'configFile'> | null {
    const projects: ProjectConfig[] = [];
    let output = '.auto-tracking';
    let owner = '';
    let root = '';
    let product = '';
    let hasPreset = false;
    let hasBranding = false;
    const branding: { logoPng?: string; watermarkPng?: string; primaryColor?: string } = {};
    let presetName = '';

    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = prop.name.getText();

      if (name === 'output') {
        output = this.extractStringLiteral(prop.initializer) ?? output;
      } else if (name === 'branding') {
        hasBranding = true;
        if (!ts.isObjectLiteralExpression(prop.initializer)) throw new Error('branding deve ser um objeto literal para leitura estática');
        for (const bp of prop.initializer.properties) {
          if (!ts.isPropertyAssignment(bp)) throw new Error('branding aceita apenas propriedades literais');
          const v = this.extractStringLiteral(bp.initializer);
          if (['logoPng', 'watermarkPng', 'primaryColor'].includes(bp.name.getText()) && !v) throw new Error(`branding.${bp.name.getText()} deve ser uma string literal não vazia`);
          if (v && bp.name.getText() === 'logoPng') branding.logoPng = v;
          if (v && bp.name.getText() === 'watermarkPng') branding.watermarkPng = v;
          if (v && bp.name.getText() === 'primaryColor') branding.primaryColor = v;
        }
      } else if (name === 'projects' && ts.isArrayLiteralExpression(prop.initializer)) {
        for (const el of prop.initializer.elements) {
          if (!ts.isObjectLiteralExpression(el)) continue;
          const p = this.extractProjectConfig(el);
          if (p) projects.push(p);
        }
      } else if (name === 'runtime' && ts.isObjectLiteralExpression(prop.initializer)) {
        for (const rp of prop.initializer.properties) {
          if (!ts.isPropertyAssignment(rp)) continue;
          const rname = rp.name.getText();
          if (rname === 'owner') owner = this.extractStringLiteral(rp.initializer) ?? owner;
          else if (rname === 'root') root = this.extractStringLiteral(rp.initializer) ?? root;
          else if (rname === 'product') product = this.extractStringLiteral(rp.initializer) ?? product;
          else if (rname === 'preset') {
            hasPreset = true;
            presetName = ts.isIdentifier(rp.initializer) ? rp.initializer.text : '';
          }
        }
      }
    }

    if (!owner || !product) return null;
    return { projects, output, owner, root, product, hasPreset, hasBranding, branding, presetName };
  }

  private extractProjectConfig(obj: ts.ObjectLiteralExpression): ProjectConfig | null {
    let angularProject = '';
    let tsconfig = '';
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = prop.name.getText();
      if (name === 'angularProject') angularProject = this.extractStringLiteral(prop.initializer) ?? '';
      else if (name === 'tsconfig') tsconfig = this.extractStringLiteral(prop.initializer) ?? '';
    }
    if (!angularProject || !tsconfig) return null;
    return { angularProject, tsconfig };
  }

  private extractStringLiteral(node: ts.Node): string | null {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return null;
  }

  readAngularWorkspace(rootDir: string): AngularWorkspace | null {
    const angularJsonPath = path.join(rootDir, 'angular.json');
    if (!fs.existsSync(angularJsonPath)) return null;

    try {
      const raw = JSON.parse(fs.readFileSync(angularJsonPath, 'utf-8')) as Record<string, unknown>;
      const projectsRaw = (raw['projects'] ?? {}) as Record<string, unknown>;
      const projects = new Map<string, { sourceRoot: string; tsconfig: string }>();

      for (const [name, proj] of Object.entries(projectsRaw)) {
        const p = proj as Record<string, unknown>;
        const sourceRoot = (p['sourceRoot'] as string | undefined) ?? 'src';
        const arch = (p['architect'] ?? p['targets']) as Record<string, unknown> | undefined;
        const buildOptions = ((arch?.['build'] as Record<string, unknown> | undefined)?.['options']) as Record<string, unknown> | undefined;
        const tsconfig = (buildOptions?.['tsConfig'] as string | undefined) ?? 'tsconfig.app.json';
        projects.set(name, { sourceRoot, tsconfig });
      }

      return { rootDir, angularJsonPath, projects };
    } catch {
      return null;
    }
  }
}

const projectConfigReader = new AngularProjectConfigReader();
export const readTrackingConfigStatically = (configFile: string): StaticTrackingConfig | null =>
  projectConfigReader.readTrackingConfigStatically(configFile);
export const readAngularWorkspace = (rootDir: string): AngularWorkspace | null => projectConfigReader.readAngularWorkspace(rootDir);
