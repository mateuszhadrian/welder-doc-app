import type { ComponentType } from 'react';
import type {
  AnchorEdge,
  AnchorPoint,
  BaseShape,
  BoundingBox,
  FieldUpdate,
  HandleGeometry,
  Point,
  StartSnapshot
} from './types';
import type { ShapeType } from '../index';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ShapeDefinition<S extends BaseShape = BaseShape> {
  type: ShapeType;
  label: string;
  icon: ComponentType;

  create: (pos: Point) => S;

  Renderer: ComponentType<{
    shape: S;
    isSelected: boolean;
    isInLockedUnit: boolean;
  }>;
  PropertiesPanel: ComponentType<{ shape: S }>;

  captureGeometry: (shape: S) => FieldUpdate;
  getBoundingBox: (shape: S) => BoundingBox;
  getWorldPoints: (shape: S) => Point[];

  getHandles: ((shape: S) => HandleGeometry) | null;
  captureStart: ((shape: S) => StartSnapshot) | null;
  applyHandleDrag:
    | ((
        start: StartSnapshot,
        kind: string,
        ldx: number,
        ldy: number,
        startLocalPtr: Point,
        sinθ: number,
        cosθ: number
      ) => FieldUpdate)
    | null;

  /** Point-snap (architecture §10.1). */
  anchors?: (shape: S) => AnchorPoint[];
  /** Edge-snap z attachmentem (architecture §10.2). */
  edges?: (shape: S) => AnchorEdge[];

  validate?: (shape: S) => ValidationError[];

  toSVG?: (shape: S) => string;
}
