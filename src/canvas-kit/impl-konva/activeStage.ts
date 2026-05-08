/**
 * Singleton ref do aktywnej Konva.Stage. Ustawiany przez `CanvasShell`
 * w `useEffect`, czytany przez `rasterize`. Implementacja Konva-specific —
 * nie wycieka poza `impl-konva/`.
 */

import type Konva from 'konva';

let activeStage: Konva.Stage | null = null;

export function setActiveStage(stage: Konva.Stage | null): void {
  // Singleton drift detector (architecture-base.md §22.6): drugi mount cicho
  // nadpisałby pierwszy i `rasterize()` operowałby na innej instancji niż
  // konsument oczekuje. Throw byłby zbyt agresywny (mount jednoczesny w
  // dev React strict-mode / Suspense); warning wystarczy do diagnostyki.
  if (
    process.env.NODE_ENV !== 'production' &&
    stage !== null &&
    activeStage !== null &&
    activeStage !== stage
  ) {
    console.warn(
      'canvas-kit: multiple CanvasShell instances detected — last mount wins. ' +
        'rasterize() will operate on the most recently mounted Stage. ' +
        'See architecture-base.md §22.6 for context.'
    );
  }
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
