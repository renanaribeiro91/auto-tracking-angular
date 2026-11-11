/** Limite de valor de parâmetro do GA4; CLI e runtime normalizam rótulos provados com o mesmo tamanho. */
export const MAX_PROVEN_LABEL = 100;

/** Rótulo provado comparável entre código e DOM: marcação HTML no literal ('A<br>B') não conta. */
export const labelSlug = (value: string | null | undefined): string => slug((value ?? '').replace(/<[^>]*>/g, ' '), MAX_PROVEN_LABEL);

/** Entidades HTML de template (`hor&aacute;rio`, `&nbsp;`, `&#233;`) viram o caractere que a pessoa lê. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal?: string, hex?: string, name?: string) => {
    if (decimal || hex) {
      const code = decimal ? Number(decimal) : parseInt(hex!, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[name!.toLowerCase()];
    if (named !== undefined) return named;
    // Letra acentuada (`aacute`, `ccedil`, `atilde`): o slug descarta o acento, resta a letra.
    const accented = /^([a-z])(?:acute|grave|circ|tilde|uml|cedil|ring)$/i.exec(name!);
    return accented ? accented[1]! : match;
  });
}

/** Normaliza texto visível em identificador estável: sem acento, minúsculo, separado por hífen; o corte respeita a palavra. */
export function slug(value: string | null | undefined, max = 60): string {
  const full = decodeEntities(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (full.length <= max) return full;
  const cut = full.slice(0, max);
  // Palavra cortada ao meio (`dif` de `diferentes`) não é texto de negócio; a primeira palavra fica mesmo longa.
  const boundary = cut.lastIndexOf('-');
  return (full[max] === '-' || boundary <= 0 ? cut : cut.slice(0, boundary)).replace(/-+$/g, '');
}

/** Junta ação e contexto sem repetir a emenda: `excluir` + `excluir-arquivo` → `excluir-arquivo`. */
export function joinLabel(action: string, context: string, max = MAX_PROVEN_LABEL): string {
  const head = action.split('-').filter(Boolean);
  const tail = context.split('-').filter(Boolean);
  let overlap = Math.min(head.length, tail.length);
  while (overlap > 0 && head.slice(-overlap).join('-') !== tail.slice(0, overlap).join('-')) overlap--;
  return slug([...head, ...tail.slice(overlap)].join('-'), max);
}

/** Estrutura de UI no nome de código ou no texto acessível (`cancelar-modal`, `tooltip-info`): não é o que a pessoa fez. */
export const UI_STRUCTURE_WORDS: ReadonlySet<string> = new Set([
  'modal', 'modais', 'popover', 'dialog', 'tooltip', 'overlay', 'sheet', 'header', 'footer', 'component', 'componente',
  'page', 'item', 'items', 'wrapper', 'container', 'opened', 'closed', 'selected', 'div', 'span', 'el', 'ref', 'click', 'clicked',
  'iframe', 'webview', 'autocomplete',
]);

/** Verbo de código em inglês na forma que o negócio lê (CLI e runtime, para a planilha bater com o envio). */
export const ENGLISH_ACTIONS: ReadonlyMap<string, string> = new Map([
  ['open', 'abrir'], ['close', 'fechar'], ['change', 'alterar'], ['select', 'selecionar'], ['selection', 'selecionar'], ['toggle', 'alternar'],
  ['show', 'mostrar'], ['hide', 'ocultar'], ['add', 'adicionar'], ['remove', 'remover'], ['delete', 'excluir'], ['edit', 'editar'],
  ['save', 'salvar'], ['send', 'enviar'], ['submit', 'enviar'], ['search', 'buscar'], ['crop', 'recortar'], ['navigate', 'navegar'],
  ['view', 'ver'], ['download', 'baixar'], ['upload', 'enviar'], ['share', 'compartilhar'], ['copy', 'copiar'], ['call', 'ligar'],
  ['confirm', 'confirmar'], ['cancel', 'cancelar'], ['back', 'voltar'], ['next', 'avancar'], ['previous', 'voltar'], ['go', 'ir'],
  ['expand', 'expandir'], ['collapse', 'recolher'], ['play', 'reproduzir'],
  // Substantivos de código/ícone que aparecem no meio do nome (`editarArchiveNota`).
  ['archive', 'arquivo'], ['file', 'arquivo'], ['image', 'imagem'], ['photo', 'foto'],
]);

/**
 * Rótulo de produto: sem "botão … da modal" do texto acessível, sem estrutura de UI e com o verbo em português.
 * Se nada sobrar, o rótulo original fica (melhor que vazio, que vira "(not set)").
 */
export function productLabel(label: string): string {
  const words = label.replace(/^botao-(?=.)/, '').replace(/-d[ao]-(?:modal|alerta|menu|popover|janela)$/, '').split('-')
    .filter((word) => word && !UI_STRUCTURE_WORDS.has(word)).map((word) => ENGLISH_ACTIONS.get(word) ?? word);
  return words.filter((word, index) => !index || word !== words[index - 1]).join('-') || label;
}

/**
 * Rótulo do clique em overlay sem marcação (CLI e runtime): a ação sozinha ("ok") não diz de qual overlay veio,
 * então leva o contexto (título ou tipo), sem repeti-lo; "botão" e "da modal" do texto acessível são ruído.
 */
export function overlayActionLabel(action: string, context: string): string {
  const gesture = productLabel(action);
  return context && !`-${gesture}-`.includes(`-${context}-`) ? joinLabel(gesture, context) : gesture;
}

/** Palavras técnicas do seletor de um componente apresentado como overlay (não o nomeiam). */
const OVERLAY_TECHNICAL_WORDS = new Set(['modal', 'component', 'page', 'popover', 'dialog', 'alert', 'sheet', 'bottom', 'overlay']);

/**
 * Nome público do componente de overlay pelo seletor (CLI e runtime): sem o prefixo da biblioteca e sem palavras
 * técnicas nas pontas (`app-erro-generico-modal` → `erro-generico`, `bsmo-modal-voucher` → `voucher`); vazio se nada sobra.
 */
export function overlayComponentName(selector: string): string {
  const parts = slug(selector, 200).split('-');
  const words = parts.length > 1 ? parts.slice(1) : parts;
  while (words.length && OVERLAY_TECHNICAL_WORDS.has(words[0]!)) words.shift();
  while (words.length && OVERLAY_TECHNICAL_WORDS.has(words[words.length - 1]!)) words.pop();
  return words.length ? productLabel(words.join('-')) : '';
}
