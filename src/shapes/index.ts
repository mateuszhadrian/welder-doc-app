/**
 * Discriminated union typów kształtów oraz ich wartości runtime'owej.
 * Aktualizowane przy dodawaniu nowego kształtu (architecture §19).
 */

export type ShapeType =
  | 'plate'
  | 'pipe-front'
  | 'pipe-longitudinal'
  | 'profile-i'
  | 'profile-c'
  | 'profile-l'
  | 'profile-t'
  | 'weld-joint';

import type { BaseShape } from './_base/types';

/**
 * Shape — discriminated union wszystkich konkretnych typów kształtów (architecture §4/§6).
 * SCAFFOLD: = BaseShape dopóki żaden kształt nie jest zaimplementowany.
 * TODO: przy dodaniu src/shapes/plate/ zmienić na:
 *   export type Shape = PlateShape | PipeFrontShape | PipeLongitudinalShape | … | WeldJointShape;
 * Każdy dodany kształt dokłada swój typ do unii (architecture §19, punkt 2).
 * Zmiana jest BREAKING dla wszystkich plików używających Shape[] (store, renderer, sidebar).
 */
export type Shape = BaseShape;
