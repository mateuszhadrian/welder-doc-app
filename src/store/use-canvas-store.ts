import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
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
  devtools(
    immer(() => ({
      _placeholder: true as const
    })),
    { name: 'CanvasStore', enabled: process.env.NODE_ENV !== 'production' }
  )
);
