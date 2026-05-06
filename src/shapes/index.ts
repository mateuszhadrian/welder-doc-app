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
 * Placeholder unii Shape — zostanie zastąpiony właściwą unią konkretnych kształtów,
 * gdy katalogi src/shapes/[type]/ zostaną wypełnione.
 */
export type Shape = BaseShape;
