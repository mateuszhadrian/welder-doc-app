/**
 * Engine-independent constants for the canvas-kit boundary (architecture §22.1).
 * Importowalne z dowolnego miejsca — żaden silnik (Konva/Pixi) nie jest tu
 * zaangażowany, więc te wartości przeżywają wymianę silnika bez modyfikacji.
 */

/** Hit-area expansion (px) dla uchwytów na urządzeniach dotykowych. */
export const HIT_AREA_TOUCH = 20;

/** Hit-area expansion (px) dla uchwytów na desktopie (mouse + pen). */
export const HIT_AREA_DESKTOP = 8;

/**
 * Bezpieczne odczytanie window.devicePixelRatio (SSR-safe).
 * Jedyne dozwolone miejsce w projekcie do czytania DPR — egzekwowane przez §22.9.4.
 */
export function devicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}
