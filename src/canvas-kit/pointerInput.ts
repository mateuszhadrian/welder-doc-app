'use client';

/**
 * Engine-independent multi-touch gesture normalizer (architecture §22.5).
 *
 * Słucha bezpośrednio DOM `PointerEvent` na podanym elemencie i emituje
 * znormalizowane gesty (`tap` / `drag` / `pinch`). Zero importów z `konva`,
 * `react-konva`, `pixi.js` — przeżywa wymianę silnika bez modyfikacji.
 *
 * Po stronie konsumenta pamiętaj:
 * - `handler` może być świeży na każdy render — trzymamy go w refie, więc
 *   nie wymuszamy `useCallback`.
 * - `setPointerCapture` jest wołany na elemencie target dla każdego pointera.
 * - Tap = pointer up w ≤ 250 ms i ≤ 5 px od pointer down.
 * - `pan` z kontraktu typów emitujemy NA TYM SAMYM payloadzie co `drag`;
 *   reklasyfikacja drag → pan należy do warstwy nad canvas-kit (mode: 'hand'
 *   vs `mode: 'select'` + brak hit testu na elemencie).
 */

import { useEffect, useRef, type RefObject } from 'react';

export interface Point {
  x: number;
  y: number;
}

export type PointerGesture =
  | {
      kind: 'tap';
      x: number;
      y: number;
      pointerId: number;
      pointerType: 'mouse' | 'touch' | 'pen';
    }
  | {
      kind: 'drag';
      start: Point;
      current: Point;
      delta: Point;
      pointerId: number;
      phase: 'start' | 'move' | 'end';
    }
  | {
      kind: 'pan';
      delta: Point;
      pointerId: number;
      phase: 'start' | 'move' | 'end';
    }
  | {
      kind: 'pinch';
      center: Point;
      scale: number;
      rotation: number;
      phase: 'start' | 'move' | 'end';
    };

const TAP_MAX_MS = 250;
const TAP_MAX_PX = 5;

interface PointerState {
  start: Point;
  current: Point;
  startTime: number;
  pointerType: 'mouse' | 'touch' | 'pen';
  emittedDragStart: boolean;
}

interface PinchState {
  startDistance: number;
  startAngle: number;
  startCenter: Point;
  emittedStart: boolean;
}

function normalizePointerType(t: string): 'mouse' | 'touch' | 'pen' {
  if (t === 'touch' || t === 'pen') return t;
  return 'mouse';
}

export function usePointerInput(
  target: RefObject<HTMLElement | null>,
  handler: (gesture: PointerGesture) => void
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const el = target.current;
    if (!el) return;

    const pointers = new Map<number, PointerState>();
    let pinch: PinchState | null = null;

    const emit = (g: PointerGesture) => handlerRef.current(g);

    const local = (e: PointerEvent): Point => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const center = (a: PointerState, b: PointerState): Point => ({
      x: (a.current.x + b.current.x) / 2,
      y: (a.current.y + b.current.y) / 2
    });

    const distance = (a: PointerState, b: PointerState): number =>
      Math.hypot(a.current.x - b.current.x, a.current.y - b.current.y);

    const angle = (a: PointerState, b: PointerState): number =>
      Math.atan2(b.current.y - a.current.y, b.current.x - a.current.x);

    const endActiveDrags = () => {
      for (const [id, st] of pointers) {
        if (!st.emittedDragStart) continue;
        emit({
          kind: 'drag',
          start: st.start,
          current: st.current,
          delta: { x: st.current.x - st.start.x, y: st.current.y - st.start.y },
          pointerId: id,
          phase: 'end'
        });
        st.emittedDragStart = false;
      }
    };

    const onDown = (e: PointerEvent) => {
      const p = local(e);
      pointers.set(e.pointerId, {
        start: p,
        current: p,
        startTime: e.timeStamp,
        pointerType: normalizePointerType(e.pointerType),
        emittedDragStart: false
      });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // jsdom + niektóre środowiska testowe nie wspierają setPointerCapture
      }

      if (pointers.size === 2) {
        endActiveDrags();
        const values = Array.from(pointers.values());
        const [a, b] = values;
        if (!a || !b) return;
        pinch = {
          startDistance: distance(a, b),
          startAngle: angle(a, b),
          startCenter: center(a, b),
          emittedStart: false
        };
      }
    };

    const onMove = (e: PointerEvent) => {
      const st = pointers.get(e.pointerId);
      if (!st) return;
      st.current = local(e);

      if (pointers.size >= 2 && pinch) {
        const values = Array.from(pointers.values());
        const [a, b] = values;
        if (!a || !b) return;
        const c = center(a, b);
        const scale = distance(a, b) / (pinch.startDistance || 1);
        const rotation = angle(a, b) - pinch.startAngle;
        if (!pinch.emittedStart) {
          emit({
            kind: 'pinch',
            center: pinch.startCenter,
            scale: 1,
            rotation: 0,
            phase: 'start'
          });
          pinch.emittedStart = true;
        }
        emit({ kind: 'pinch', center: c, scale, rotation, phase: 'move' });
        return;
      }

      const dx = st.current.x - st.start.x;
      const dy = st.current.y - st.start.y;

      if (!st.emittedDragStart) {
        if (Math.hypot(dx, dy) > TAP_MAX_PX) {
          st.emittedDragStart = true;
          emit({
            kind: 'drag',
            start: st.start,
            current: st.current,
            delta: { x: dx, y: dy },
            pointerId: e.pointerId,
            phase: 'start'
          });
        }
        return;
      }

      emit({
        kind: 'drag',
        start: st.start,
        current: st.current,
        delta: { x: dx, y: dy },
        pointerId: e.pointerId,
        phase: 'move'
      });
    };

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const st = pointers.get(e.pointerId);
      if (!st) return;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // see onDown
      }

      if (pinch) {
        if (pinch.emittedStart) {
          const others = Array.from(pointers.entries()).filter(([id]) => id !== e.pointerId);
          const otherEntry = others[0];
          const other = otherEntry?.[1];
          const c: Point = other
            ? { x: (st.current.x + other.current.x) / 2, y: (st.current.y + other.current.y) / 2 }
            : pinch.startCenter;
          emit({ kind: 'pinch', center: c, scale: 1, rotation: 0, phase: 'end' });
        }
        pinch = null;
        pointers.delete(e.pointerId);
        return;
      }

      if (st.emittedDragStart) {
        emit({
          kind: 'drag',
          start: st.start,
          current: st.current,
          delta: { x: st.current.x - st.start.x, y: st.current.y - st.start.y },
          pointerId: e.pointerId,
          phase: 'end'
        });
      } else if (!cancelled) {
        const elapsed = e.timeStamp - st.startTime;
        const moved = Math.hypot(st.current.x - st.start.x, st.current.y - st.start.y);
        if (elapsed <= TAP_MAX_MS && moved <= TAP_MAX_PX) {
          emit({
            kind: 'tap',
            x: st.current.x,
            y: st.current.y,
            pointerId: e.pointerId,
            pointerType: st.pointerType
          });
        }
      }

      pointers.delete(e.pointerId);
    };

    const onUp = (e: PointerEvent) => finish(e, false);
    const onCancel = (e: PointerEvent) => finish(e, true);

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [target]);
}
