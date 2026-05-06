/**
 * Canvas-kit public API (architecture §22.1).
 *
 * To jest **jedyny** punkt styku domeny aplikacji z silnikiem renderującym.
 * Wymiana Konva → PixiJS = nowa implementacja w `impl-pixi/` + przełączenie
 * trzech re-eksportów poniżej. Cała reszta kodu (`src/store/`, `src/lib/`,
 * `src/shapes/`, `src/weld-units/`, `src/components/sidebar/`, …) zostaje
 * bez modyfikacji.
 *
 * Granicę egzekwuje ESLint (`no-restricted-imports`): import `konva` /
 * `react-konva` / `pixi.js` / `@pixi/*` poza `src/canvas-kit/impl-*` i
 * `src/components/canvas/` jest błędem.
 */

// Komponenty kontenerowe
export { CanvasShell, GroupLayer, OverlayLayer } from './impl-konva';

// Prymitywy graficzne (deklaratywne, React)
export { G, Rect, Line, Arc, Circle, Path, Text } from './impl-konva';

// Eksport rastrowy
export { rasterize } from './impl-konva';

// Wejście pointerowe (znormalizowane gesty)
export { usePointerInput } from './pointerInput';
export type { PointerGesture, Point } from './pointerInput';

// Stałe (DPR + hit-area)
export { HIT_AREA_TOUCH, HIT_AREA_DESKTOP, devicePixelRatio } from './constants';

// Typy props prymitywów (do użycia przez shape `Renderer`-y)
export type {
  CommonShapeProps,
  GProps,
  RectProps,
  LineProps,
  ArcProps,
  CircleProps,
  PathProps,
  TextProps,
  RasterizeOptions,
  CanvasPointerHandler
} from './primitives';
