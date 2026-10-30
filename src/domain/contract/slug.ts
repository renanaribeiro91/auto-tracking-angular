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
