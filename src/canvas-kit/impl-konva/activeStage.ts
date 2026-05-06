/**
 * Singleton ref do aktywnej Konva.Stage. Ustawiany przez `CanvasShell`
 * w `useEffect`, czytany przez `rasterize`. Implementacja Konva-specific —
 * nie wycieka poza `impl-konva/`.
 */

import type Konva from 'konva';

let activeStage: Konva.Stage | null = null;

export function setActiveStage(stage: Konva.Stage | null): void {
  activeStage = stage;
}

export function getActiveStage(): Konva.Stage {
  if (!activeStage) {
    throw new Error(
      'canvas-kit: no active CanvasShell — rasterize() called outside the canvas tree'
    );
  }
  return activeStage;
}
