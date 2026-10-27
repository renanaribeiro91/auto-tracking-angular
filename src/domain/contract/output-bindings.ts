/** Gesto comprovado no DOM relacionado ao @Output público de um componente. */
export interface OutputBinding {
  readonly id: string;
  readonly event: string;
  readonly selector: string;
  readonly label: string;
  readonly output: string;
}

/** v1: id|evento|seletor|rótulo|output; v2: metadados por output + gestos. */
const VERSION = 'v2:';

function compact(value: string): string {
  // '~' não é codificado por encodeURIComponent e é nosso separador de gestos.
  return encodeURIComponent(value).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function expand(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}

/** Sempre lê o formato já instalado em consumidores (v1) e o compacto (v2). */
export function decodeOutputBindings(value: string | null | undefined): OutputBinding[] {
  if (!value) return [];
  if (!value.startsWith(VERSION)) {
    return value.split(';').flatMap((part) => {
      const [id, event, selector, label = '', output = ''] = part.split('|');
      return id && event && selector ? [{ id, event, selector, label, output }] : [];
    });
  }
  const result: OutputBinding[] = [];
  for (const group of value.slice(VERSION.length).split(';')) {
    const parts = group.split('|');
    if (parts.length !== 4) continue;
    const id = expand(parts[0]!);
    const label = expand(parts[1]!);
    const output = expand(parts[2]!);
    if (!id || label === null || !output) continue;
    for (const gesture of parts[3]!.split('~')) {
      const separator = gesture.indexOf(',');
      if (separator < 1) continue;
      const event = expand(gesture.slice(0, separator));
      const selector = expand(gesture.slice(separator + 1));
      if (event && selector) result.push({ id, event, selector, label, output });
    }
  }
  return result;
}

/** Agrupa repetições sem mudar o ID emitido, o seletor ou o tipo de evento. */
export function encodeOutputBindings(bindings: readonly OutputBinding[]): string {
  const legacy = bindings.map(({ id, event, selector, label, output }) =>
    `${id}|${event}|${selector}|${label}|${output}`).join(';');
  const groups: { key: string; id: string; label: string; output: string; gestures: string[] }[] = [];
  for (const binding of bindings) {
    const key = JSON.stringify([binding.id, binding.label, binding.output]);
    let group = groups[groups.length - 1];
    // Grupos contíguos preservam a precedência original de seletores/eventos.
    if (!group || group.key !== key) {
      group = { key, id: binding.id, label: binding.label, output: binding.output, gestures: [] };
      groups.push(group);
    }
    group.gestures.push(`${compact(binding.event)},${compact(binding.selector)}`);
  }
  const encoded = VERSION + groups.map((group) =>
    `${compact(group.id)}|${compact(group.label)}|${compact(group.output)}|${group.gestures.join('~')}`).join(';');
  // O formato antigo não consegue escapar delimitadores nem aspas do HTML.
  const legacyUnsafe = bindings.some((binding) =>
    [binding.id, binding.event, binding.selector, binding.label, binding.output]
      .some((value) => /[|;"']/.test(value)));
  return legacyUnsafe || encoded.length < legacy.length ? encoded : legacy;
}

/** Manifesto estático embutido no bundle do aplicativo, sem fetch em runtime. */
export type OutputBindingManifest = Readonly<Record<string, readonly OutputBinding[]>>;
