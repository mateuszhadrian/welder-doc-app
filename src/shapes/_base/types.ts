/**
 * Bazowe typy współdzielone przez wszystkie kształty (architecture §4).
 * Konkretne typy kształtów (PlateShape, PipeFrontShape itp.) — w katalogach src/shapes/[type]/types.ts.
 */

import type { ShapeType } from '../index';

// Point pochodzi z canvas-kit (silnik 2D — kanoniczne źródło dla geometrii 2D).
// Re-eksport tutaj dla wygody: shape moduły konsumują geometrię i typy domeny
// z jednego pliku.
export type { Point } from '@/canvas-kit';
import type { Point } from '@/canvas-kit';

export interface BaseShape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface HandleDescriptor {
  kind: string;
  x: number;
  y: number;
  cursor?: string;
}

export interface HandleGeometry {
  bbox: BoundingBox;
  sides: HandleDescriptor[];
  scale: Point;
  rotate: Point;
}

export interface AnchorPoint {
  id: string;
  x: number;
  y: number;
  /** Kąt normalnej wychodzącej, 0 = prawo. */
  direction?: number;
}

export interface AnchorEdge {
  id: string;
  /** Start odcinka (world). */
  a: Point;
  /** Koniec odcinka (world). */
  b: Point;
  /** Kąt normalnej zewnętrznej, 0 = prawo. */
  direction: number;
}

export interface StartSnapshot {
  x: number;
  y: number;
  rotation: number;
}

export type FieldUpdate = Partial<Record<string, unknown>>;
