/** Limite de valor de parâmetro do GA4; CLI e runtime normalizam rótulos provados com o mesmo tamanho. */
export const MAX_PROVEN_LABEL = 100;

/** Rótulo provado comparável entre código e DOM: marcação HTML no literal ('A<br>B') não conta. */
export const labelSlug = (value: string | null | undefined): string => slug((value ?? '').replace(/<[^>]*>/g, ' '), MAX_PROVEN_LABEL);

/** Normaliza texto visível em identificador estável: sem acento, minúsculo, separado por hífen */
export function slug(value: string | null | undefined, max = 60): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/**
 * Rótulo do clique em overlay sem marcação (CLI e runtime): a ação sozinha ("ok") não diz de qual overlay veio,
 * então leva o contexto (título ou tipo), sem repeti-lo; "botão" e "da modal" do texto acessível são ruído.
 */
export function overlayActionLabel(action: string, context: string): string {
  const gesture = action.replace(/^botao-/, '').replace(/-d[ao]-(?:modal|alerta|menu|popover|janela)$/, '');
  return context && !gesture.includes(context) ? slug(`${gesture}-${context}`, MAX_PROVEN_LABEL) : gesture;
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
  return words.join('-');
}
