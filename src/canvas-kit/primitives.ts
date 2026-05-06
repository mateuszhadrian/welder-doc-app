/**
 * Engine-agnostic primitive props (architecture §22.2).
 *
 * Każdy props ma 1:1 odpowiednik w Konvie i PixiJS. Brak Konva-specific
 * properties (`shadowBlur`, `cache()`, `Konva.Animation`, …) — jeśli efekt
 * jest niezbędny, dodajemy go tutaj i implementujemy w obu backendach.
 *
 * Pointer handlery dostają znormalizowany DOM `PointerEvent` (nie
 * `KonvaEventObject` ani `FederatedPointerEvent`) — backend wypakuje go
 * z natywnego eventu silnika.
 */

import type { ReactNode } from 'react';

export type CanvasPointerHandler = (e: PointerEvent) => void;

export interface CommonShapeProps {
  x?: number;
  y?: number;
  rotation?: number;
  opacity?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Hit area expansion in px (touch-friendly handles). */
  hitStrokeWidth?: number;
  visible?: boolean;
  listening?: boolean;
  onPointerDown?: CanvasPointerHandler;
  onPointerMove?: CanvasPointerHandler;
  onPointerUp?: CanvasPointerHandler;
  onPointerCancel?: CanvasPointerHandler;
}

export interface GProps extends CommonShapeProps {
  children?: ReactNode;
}

export interface RectProps extends CommonShapeProps {
  width: number;
  height: number;
  cornerRadius?: number;
}

export interface LineProps extends CommonShapeProps {
  points: number[];
  closed?: boolean;
  dash?: number[];
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'miter' | 'round' | 'bevel';
}

export interface ArcProps extends CommonShapeProps {
  innerRadius: number;
  outerRadius: number;
  /** Sweep angle in degrees. */
  angle: number;
}

export interface CircleProps extends CommonShapeProps {
  radius: number;
}

export interface PathProps extends CommonShapeProps {
  /** SVG path data. */
  d: string;
}

export interface TextProps extends CommonShapeProps {
  text: string;
  fontSize: number;
  fontFamily?: string;
  align?: 'left' | 'center' | 'right';
  width?: number;
}

/**
 * Rasterize options (architecture §22.6).
 * `area: 'content'` = bounding box of all shapes + 20px padding.
 */
export interface RasterizeOptions {
  format: 'png' | 'jpg';
  area: 'full' | 'content';
  pixelRatio?: number;
  /** JPEG quality, 0..1. Ignored for PNG. */
  quality?: number;
}
