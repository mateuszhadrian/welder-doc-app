'use client';

/**
 * Stage + Layer wrapper. Jedyne miejsce w projekcie, w którym czytane jest
 * `window.devicePixelRatio` (architecture §22.9.4). Singleton ref do aktywnego
 * Stage'u jest udostępniany `rasterize()` przez `activeStage.ts`.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Stage, Layer } from 'react-konva';
import type Konva from 'konva';

import { devicePixelRatio } from '../constants';
import { setActiveStage } from './activeStage';

interface CanvasShellProps {
  width: number;
  height: number;
  children?: ReactNode;
}

export function CanvasShell({ width, height, children }: CanvasShellProps) {
  const stageRef = useRef<Konva.Stage>(null);

  useEffect(() => {
    setActiveStage(stageRef.current);
    return () => setActiveStage(null);
  }, []);

  return (
    <Stage ref={stageRef} width={width} height={height} pixelRatio={devicePixelRatio()}>
      {children}
    </Stage>
  );
}

/** Warstwa kształtów domeny — pod overlayami uchwytów/snapów. */
export function GroupLayer({ children }: { children?: ReactNode }) {
  return <Layer>{children}</Layer>;
}

/** Warstwa overlayów (uchwyty, marquee, podświetlenia snapów, etykiety). */
export function OverlayLayer({ children }: { children?: ReactNode }) {
  return <Layer>{children}</Layer>;
}
