'use client';

/**
 * react-konva mapping of canvas-kit primitives. Wszystkie publiczne props
 * pochodzą z `../primitives` — żaden import strony klienckiej nie powinien
 * widzieć Konva-specific properties.
 *
 * Pointer eventy: Konva emituje `KonvaEventObject<PointerEvent>`, ale na
 * granicy canvas-kit propagujemy wyłącznie znormalizowany DOM `PointerEvent`
 * (`e.evt`). Dzięki temu logika nad canvas-kit jest niezależna od silnika.
 */

import {
  Group,
  Rect as KRect,
  Line as KLine,
  Arc as KArc,
  Circle as KCircle,
  Path as KPath,
  Text as KText
} from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';

import type {
  ArcProps,
  CanvasPointerHandler,
  CircleProps,
  CommonShapeProps,
  GProps,
  LineProps,
  PathProps,
  RectProps,
  TextProps
} from '../primitives';

type KonvaPointerHandler = (e: KonvaEventObject<PointerEvent>) => void;

function unwrap(handler: CanvasPointerHandler | undefined): KonvaPointerHandler | undefined {
  if (!handler) return undefined;
  return (e) => handler(e.evt);
}

type PointerProps = Pick<
  CommonShapeProps,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
>;

function pointerHandlers(p: PointerProps) {
  return {
    onPointerdown: unwrap(p.onPointerDown),
    onPointermove: unwrap(p.onPointerMove),
    onPointerup: unwrap(p.onPointerUp),
    onPointercancel: unwrap(p.onPointerCancel)
  };
}

export function G({
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...rest
}: GProps) {
  return (
    <Group
      {...rest}
      {...pointerHandlers({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel })}
    >
      {children}
    </Group>
  );
}

export function Rect({
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...rest
}: RectProps) {
  return (
    <KRect
      {...rest}
      {...pointerHandlers({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel })}
    />
  );
}

export function Line({
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...rest
}: LineProps) {
  return (
    <KLine
      {...rest}
      {...pointerHandlers({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel })}
    />
  );
}

export function Arc({
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...rest
}: ArcProps) {
  return (
    <KArc
      {...rest}
      {...pointerHandlers({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel })}
    />
  );
}

export function Circle({
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...rest
}: CircleProps) {
  return (
    <KCircle
      {...rest}
      {...pointerHandlers({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel })}
    />
  );
}

/**
 * Konva oczekuje SVG path data w propsie `data`; canvas-kit używa `d`
 * (idiomatyczne dla SVG). Mapowanie tutaj.
 */
export function Path({
  d,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...rest
}: PathProps) {
  return (
    <KPath
      {...rest}
      data={d}
      {...pointerHandlers({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel })}
    />
  );
}

export function Text({
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...rest
}: TextProps) {
  return (
    <KText
      {...rest}
      {...pointerHandlers({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel })}
    />
  );
}
