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
