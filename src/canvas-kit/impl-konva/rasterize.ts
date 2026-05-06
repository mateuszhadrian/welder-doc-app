/**
 * Rasterize implementation — Konva backend (architecture §22.6).
 *
 * `area: 'full'` eksportuje cały Stage; `area: 'content'` dolicza bbox
 * widocznej zawartości + 20px paddingu. Migracja na PixiJS = nowa
 * implementacja w `impl-pixi/rasterize.ts` (deleguje do `app.renderer.extract.blob`).
 */

import { devicePixelRatio } from '../constants';
import type { RasterizeOptions } from '../primitives';
import { getActiveStage } from './activeStage';

const CONTENT_PADDING_PX = 20;

export async function rasterize(opts: RasterizeOptions): Promise<Blob> {
  const stage = getActiveStage();
  const mimeType = opts.format === 'jpg' ? 'image/jpeg' : 'image/png';
  const pixelRatio = opts.pixelRatio ?? devicePixelRatio();

  const config: {
    mimeType: string;
    pixelRatio: number;
    quality?: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  } = {
    mimeType,
    pixelRatio
  };

  if (opts.format === 'jpg' && typeof opts.quality === 'number') {
    config.quality = opts.quality;
  }

  if (opts.area === 'content') {
    const rect = stage.getClientRect({ skipTransform: false });
    config.x = rect.x - CONTENT_PADDING_PX;
    config.y = rect.y - CONTENT_PADDING_PX;
    config.width = rect.width + CONTENT_PADDING_PX * 2;
    config.height = rect.height + CONTENT_PADDING_PX * 2;
  }

  const dataUrl = stage.toDataURL(config);
  const response = await fetch(dataUrl);
  return await response.blob();
}
