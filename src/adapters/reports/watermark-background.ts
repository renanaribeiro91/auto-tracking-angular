import { PNG } from 'pngjs';

/** Repetição sutil de uma marca fornecida pelo aplicativo, sem geometria de desenho
 * no arquivo XLSX. Usada somente como imagem de fundo nativa da planilha. */
export function createWorksheetBackground(sourcePng: Buffer): Buffer {
  const source = PNG.sync.read(sourcePng);
  const { width, height, data } = source;
  let minX = width, minY = height, maxX = -1, maxY = -1, strongest = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const opacity = data[i + 3]! / 255;
    const ink = opacity * Math.max(255 - data[i]!, 255 - data[i + 1]!, 255 - data[i + 2]!);
    strongest = Math.max(strongest, ink);
    if (ink < 12) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX < minX) return sourcePng;

  // A unidade de repetição se alinha exatamente nas bordas, inclusive durante
  // a rolagem horizontal/vertical. A marca e suas cores não são embutidas na lib.
  const tile = new PNG({ width: 880, height: 560 });
  tile.data.fill(255);
  const markWidth = maxX - minX + 1;
  const markHeight = maxY - minY + 1;
  const targetWidth = 185;
  const targetHeight = targetWidth * markHeight / markWidth;
  const angle = -20 * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const maxInk = 53;
  const inkScale = Math.min(1, maxInk / Math.max(1, strongest));
  const halfExtent = 125;

  // Distribuição alternada em diagonal: 4 colunas × 4 faixas por tile.
  // Extrações nas bordas são embrulhadas, sem cortes ou emendas aparentes.
  for (let band = -1; band <= 4; band++) {
    const cy = 68 + band * 140;
    const shift = band % 2 === 0 ? 0 : 110;
    for (let col = -2; col <= 5; col++) {
      const cx = 98 + col * 220 + shift;
      for (let dy = -halfExtent; dy <= halfExtent; dy++) {
        for (let dx = -halfExtent; dx <= halfExtent; dx++) {
          const localX = cos * dx + sin * dy;
          const localY = -sin * dx + cos * dy;
          if (Math.abs(localX) > targetWidth / 2 || Math.abs(localY) > targetHeight / 2) continue;
          const sourceX = minX + (localX / targetWidth + 0.5) * markWidth;
          const sourceY = minY + (localY / targetHeight + 0.5) * markHeight;
          const sx = Math.max(minX, Math.min(maxX, Math.round(sourceX)));
          const sy = Math.max(minY, Math.min(maxY, Math.round(sourceY)));
          const si = (sy * width + sx) * 4;
          const alpha = data[si + 3]! / 255;
          const tx = ((Math.round(cx + dx) % tile.width) + tile.width) % tile.width;
          const ty = ((Math.round(cy + dy) % tile.height) + tile.height) % tile.height;
          const di = (ty * tile.width + tx) * 4;
          for (let channel = 0; channel < 3; channel++) {
            const value = 255 - Math.round((255 - data[si + channel]!) * alpha * inkScale);
            tile.data[di + channel] = Math.min(tile.data[di + channel]!, value);
          }
        }
      }
    }
  }
  return PNG.sync.write(tile);
}
