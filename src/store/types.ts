import type { ShapeType } from '@/shapes';

/**
 * AllShapeGeometry (architecture §8) — intersekcja Omit<*Shape, 'id' | 'type'> dla każdego kształtu MVP.
 * SCAFFOLD: puste {} dopóki żaden kształt nie jest zaimplementowany.
 * TODO: przy dodaniu pierwszego src/shapes/[typ]/ zastąpić scaffolda pełną intersectionem:
 *   type AllShapeGeometry = Omit<PlateShape, 'id'|'type'> & Omit<PipeFrontShape, 'id'|'type'> & …
 * Zmiana jest BREAKING dla wszystkich call-sites commitShapeUpdate.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AllShapeGeometry = {};

export type ShapeUpdate = Partial<AllShapeGeometry & { type: ShapeType }>;
