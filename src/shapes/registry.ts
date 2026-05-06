import type { ShapeDefinition } from './_base/definition';
import type { BaseShape } from './_base/types';
import type { ShapeType } from './index';

/**
 * Centralny rejestr kształtów (architecture §5).
 * Każdy nowy kształt rejestruje się tutaj — infrastruktura (store, handles, sidebar, SNAP, eksport)
 * operuje wyłącznie na interfejsie ShapeDefinition.
 *
 * Wpisy będą dodawane wraz z implementacją kolejnych typów.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SHAPE_REGISTRY: Partial<Record<ShapeType, ShapeDefinition<any>>> = {};

export function getShapeDefinition<S extends BaseShape>(type: ShapeType): ShapeDefinition<S> {
  const def = SHAPE_REGISTRY[type];
  if (!def) {
    throw new Error(`No ShapeDefinition registered for type "${type}"`);
  }
  return def as ShapeDefinition<S>;
}
