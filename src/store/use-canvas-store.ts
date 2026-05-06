import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/**
 * Złożony Zustand store (architecture §8). Slice'y dodawane iteracyjnie:
 * ShapesSlice, WeldUnitsSlice, HistorySlice, CanvasSlice, UISlice, DocumentSlice.
 */
export interface CanvasStore {
  /** Placeholder — schemat slice'ów wypełniany w kolejnych zadaniach. */
  readonly _placeholder: true;
}

export const useCanvasStore = create<CanvasStore>()(
  immer(() => ({
    _placeholder: true
  }))
);
