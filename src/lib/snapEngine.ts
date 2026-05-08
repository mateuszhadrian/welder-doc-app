// Geometria 2D (`Point`) z canvas-kit — kanoniczne źródło (architecture §22.7).
// Domenowe `AnchorEdge` / `AnchorPoint` z shapes/_base — cykl odwrotny
// (shapes/ → lib/snapEngine) jest zakazany.
import type { Point } from '@/canvas-kit';
import type { AnchorEdge, AnchorPoint } from '@/shapes/_base/types';

/**
 * Czyste funkcje SNAP engine (architecture §10.4).
 * Implementacja wypełniana w iteracji po dodaniu kształtów.
 */

export const POINT_SNAP_THRESHOLD = 8;
export const ATTACH_THRESHOLD = 8;
export const RELEASE_THRESHOLD = 16;
export const PARALLEL_TOLERANCE = 0.087; // sin(5°)

export interface SnapAttachment {
  draggedShapeId: string;
  draggedEdgeId: string;
  targetShapeId: string;
  targetEdgeId: string;
  /** Pozycja punktu kontaktu wzdłuż target edge, 0..1. */
  param: number;
}

export function findPointSnap(
  _source: Point,
  _candidates: AnchorPoint[],
  _threshold: number
): AnchorPoint | null {
  return null;
}

export function findEdgeAttachment(
  _draggedEdges: AnchorEdge[],
  _targetEdges: { shapeId: string; edges: AnchorEdge[] }[],
  _attachThreshold: number,
  _parallelTolerance: number
): SnapAttachment | null {
  return null;
}

export function applySlide(
  _attachment: SnapAttachment,
  _targetEdge: AnchorEdge,
  _pointerDelta: Point,
  _perpAccum: number,
  _releaseThreshold: number
): { delta: Point; nextPerpAccum: number; release: boolean } {
  return { delta: { x: 0, y: 0 }, nextPerpAccum: 0, release: false };
}
