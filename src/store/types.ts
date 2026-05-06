import type { ShapeType } from '@/shapes';

/**
 * ShapeUpdate (architecture §8) — ścisły typ używany w store na granicy commit/transient.
 * Po dodaniu konkretnych kształtów AllShapeGeometry powstaje jako intersekcja Omit<*Shape, 'id' | 'type'>.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AllShapeGeometry = {};

export type ShapeUpdate = Partial<AllShapeGeometry & { type: ShapeType }>;
