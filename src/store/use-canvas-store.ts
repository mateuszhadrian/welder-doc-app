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
  /**
   * Reset user-scoped state on sign-out (US-003) and post-account-delete.
   *
   * Currently a no-op — user-scoped slices (profile, documents, subscription)
   * have not yet been implemented. When they land, this action MUST clear them
   * in-place. It MUST NEVER touch:
   *   - localStorage `welderdoc_autosave` / `welderdoc_migrated_at`
   *     (guest autosave must survive sign-out — architecture §13)
   *   - ShapesSlice / HistorySlice / UISlice.canvas
   *     (guest mode keeps editing the canvas after sign-out)
   *
   * See `.ai/api-endpoints-implementation-plans/logout-post-endpoint-implementation-plan.md` §5.3.
   */
  resetUserScoped: () => void;
}

export const useCanvasStore = create<CanvasStore>()(
  devtools(
    immer(() => ({
      _placeholder: true as const,
      resetUserScoped: () => {
        // No-op until user-scoped slices land.
      }
    })),
    { name: 'CanvasStore', enabled: process.env.NODE_ENV !== 'production' }
  )
);

/** Custom hook per slice convention (CLAUDE.md — Zustand store conventions). */
export const useResetUserScoped = () => useCanvasStore((s) => s.resetUserScoped);
