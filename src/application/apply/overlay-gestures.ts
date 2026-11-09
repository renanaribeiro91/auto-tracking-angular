import type { ComponentDef } from './ports/component-catalog.js';
import type { OverlaySite } from './ports/project-index.js';
import { ATTRIBUTE_PATTERN, START_TAG_PATTERN } from './template-analysis.constants.js';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ACTION_TAG = /^(?:button|ion-button|ion-fab-button|ion-chip)$/;
const ACTION_ROLE = /^(?:button|link|radio|checkbox|option)$/;

/** Texto do gesto no template: atributo acessível, texto fixo ou `{{ input }}` com valor literal na abertura; `null` em runtime. */
function gestureText(template: string, tag: string, end: number, attrs: ReadonlyMap<string, string>, site: OverlaySite): string | null {
  const fixed = ['aria-label', 'label', 'title'].map((name) => attrs.get(name)).find((value) => value?.trim() && !value.includes('{{'));
  if (fixed) return fixed;
  const close = template.indexOf(`</${tag}`, end);
  const text = (close < 0 ? '' : template.slice(end, close)).replace(/<[^>]*>/g, ' ').trim();
  const input = /^\{\{\s*(\w+)\s*\}\}$/.exec(text)?.[1];
  if (input) {
    const value = site.props?.get(input);
    return typeof value === 'string' ? value : null;
  }
  return text && !text.includes('{{') ? text : null;
}

/**
 * Gestos de um overlay sem template no projeto: os declarados na abertura e os do template do componente de
 * biblioteca apresentado, respeitando `*ngIf`/`*ngFor` pelas opções da abertura. `null` é gesto que só existe em runtime.
 */
export function overlayGestures(site: OverlaySite, def: ComponentDef | undefined): (string | null)[] {
  const gestures: (string | null)[] = [...(site.botoes ?? [])];
  const inputOn = (name: string): boolean => {
    const value = site.props?.get(name);
    return value === undefined ? !!def?.truthyInputs?.has(name) : value !== false;
  };
  const guardOff = (expression: string | undefined): boolean => {
    const guard = /^\s*(!?)\s*(\w+)\s*(?:;|$)/.exec(expression ?? '');
    return !!guard && inputOn(guard[2]!) === !!guard[1];
  };
  const template = def?.template ?? '';
  const stack: { tag: string; off: boolean; list?: string }[] = [];
  for (const match of template.matchAll(new RegExp(`${START_TAG_PATTERN.source}|</[a-zA-Z][\\w-]*\\s*>`, 'g'))) {
    if (match[0].startsWith('</')) {
      const open = stack.map((item) => item.tag).lastIndexOf(match[0].slice(2).replace(/\s*>$/, ''));
      if (open >= 0) stack.length = open;
      continue;
    }
    const tag = match[1]!;
    const attrs = new Map([...(match[2] ?? '').matchAll(ATTRIBUTE_PATTERN)].map((item) => [item[1]!, item[2] ?? item[3] ?? item[4] ?? '']));
    const parent = stack[stack.length - 1];
    const off = !!parent?.off || guardOff(attrs.get('*ngIf'));
    const list = /\bof\s+(\w+)/.exec(attrs.get('*ngFor') ?? '')?.[1] ?? parent?.list;
    const clickable = attrs.has('(click)');
    const action = ACTION_TAG.test(tag) || ACTION_ROLE.test(attrs.get('role') ?? '') || (clickable && (tag === 'a' || tag === 'ion-item' || tag.includes('-')));
    if (action && !off) {
      if (!list) gestures.push(gestureText(template, tag, match.index + match[0].length, attrs, site));
      else if (!site.listas?.includes(list) && (!site.props || inputOn(list))) gestures.push(null);
    }
    if (!VOID_TAGS.has(tag) && !match[0].endsWith('/>')) stack.push({ tag, off, ...(list ? { list } : {}) });
  }
  return gestures.length || site.botoes ? gestures : [null];
}
