import { describe, expect, it } from 'vitest';
import { SHAPE_REGISTRY } from '@/shapes/registry';
import type { AllShapeGeometry } from '@/store/types';

// Bramka kontraktu (architecture §19, code-doc-v5 §2.6):
// `AllShapeGeometry = {}` to scaffold akceptowalny TYLKO dopóki `SHAPE_REGISTRY`
// jest pusty. Pierwszy zarejestrowany kształt MUSI iść w parze z aktualizacją
// `src/store/types.ts` (`AllShapeGeometry = Omit<FirstShape, 'id'|'type'> & ...`).
// Bez tego `ShapeUpdate = Partial<AllShapeGeometry & { type: ShapeType }>`
// redukuje się do `Partial<{ type: ShapeType }>` i call-sites
// `commitShapeUpdate` / `updateShapeTransient` tracą bezpieczeństwo typów.

type IsEmpty<T> = keyof T extends never ? true : false;

// Type-level tripwire: gdy `AllShapeGeometry` przestanie być pustym `{}`,
// `IsEmpty<AllShapeGeometry>` zewaluuje się do `false` i poniższa linia
// nie skompiluje się — wymusi przejrzenie i aktualizację tego testu (zmiana
// `true` na `false` po dodaniu pierwszego kształtu i intersectionu).
const allShapeGeometryIsEmpty: IsEmpty<AllShapeGeometry> = true;

describe('AllShapeGeometry contract', () => {
  it('intersection musi mieć przynajmniej jedno pole gdy SHAPE_REGISTRY ma >= 1 wpis', () => {
    const registered = Object.keys(SHAPE_REGISTRY).length;

    if (registered === 0) {
      // Scaffold acceptable: empty registry + empty intersection.
      expect(allShapeGeometryIsEmpty).toBe(true);
      return;
    }

    // SHAPE_REGISTRY ma wpisy — `AllShapeGeometry` MUSI być pełnym intersectionem.
    // Gdy zostawione jako `{}`, ten test fail'uje na runtime, sygnalizując bug.
    expect(allShapeGeometryIsEmpty).toBe(false);
  });
});
