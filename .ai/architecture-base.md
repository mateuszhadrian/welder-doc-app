# Architektura WelderDoc

WelderDoc to przeglądarkowa aplikacja SaaS do tworzenia proporcjonalnych przekrojów złączy spawanych i sekwencji ściegów spawania.

Wymagania wydajnościowe: ≥ 30 FPS przy typowych scenach; < 200 ms reakcji UI na operacje edycji.

---

## 1. Stos technologiczny

| Warstwa | Technologia |
|---|---|
| Framework frontendowy | Next.js (App Router), React, TypeScript |
| Silnik canvas | Konva.js via `react-konva` |
| Zarządzanie stanem | Zustand + Immer |
| Styling | Tailwind CSS |
| Ikony | Lucide React |
| Backend / baza danych | Supabase (PostgreSQL, region EU — Frankfurt) |
| Autentykacja | Supabase Auth (email+hasło, opcjonalnie OAuth) |
| Hosting | Vercel |
| CI/CD | GitHub Actions |
| Płatności | Paddle (Merchant of Record) |
| Internacjonalizacja | `next-intl` |
| Testy jednostkowe | Vitest (`jsdom` environment + `vitest-canvas-mock`), `@vitejs/plugin-react`, @testing-library/react, @testing-library/jest-dom (`/vitest`) |
| Testy e2e | Playwright (`@playwright/test`) |

---

## 2. Zasady projektowe

1. **Shape Registry:** `SHAPE_REGISTRY` mapuje `ShapeType` → `ShapeDefinition<S>`. Infrastruktura (store, uchwyty, sidebar, SNAP, eksport) operuje wyłącznie na interfejsie `ShapeDefinition`. Dodanie nowego kształtu nie modyfikuje infrastruktury.

2. **Z-index = kolejność w `shapes[]`.** Brak systemu warstw. Operacje z-index to czysty reorder tablicy.

3. **WeldUnit = sztywna jednostka ruchu.** Złącze spawalnicze zablokowane z elementami tworzy `WeldUnit` — elementy wewnątrz nie mogą być przesuwane niezależnie. Modyfikacja geometrii złącza odbywa się wyłącznie przez jego uchwyty lub w trybie sekwencji ściegów.

4. **Pointer Events API (`pointer*`) wszędzie** — nie używać `mouse*` ani `touch*` w komponentach canvas. `setPointerCapture` przy każdym starcie dragu.

5. **Transient vs. committed:** `updateShapeTransient` — live drag bez historii; `commitShapeUpdate` — koniec operacji z wpisem do `history[]`.

6. **`FieldUpdate` / `ShapeUpdate` boundary:** `ShapeDefinition` używa luźnego `FieldUpdate = Partial<Record<string, unknown>>`. Store używa ścisłego `ShapeUpdate` (intersection-derived). Rozwiązanie cyklu importów `shapes/` ↔ `store/`.

---

## 3. Struktura katalogów

```
src/
  shapes/
    _base/
      types.ts              ← Point, BaseShape, BoundingBox, HandleGeometry, AnchorPoint, FieldUpdate
      definition.ts         ← ShapeDefinition<S> interface
    registry.ts             ← SHAPE_REGISTRY: Record<ShapeType, ShapeDefinition<any>>
    index.ts                ← Shape union, ShapeType union
    plate/
      types.ts
      index.ts              ← ShapeDefinition<PlateShape>
      handles.ts
      anchors.ts
      PropertiesPanel.tsx
    pipe-front/             ← przekrój czołowy rury (pierścień)
    pipe-longitudinal/      ← przekrój podłużny rury (prostokąt + oś)
    profile-i/
    profile-c/
    profile-l/
    profile-t/
    weld-joint/
      types.ts
      index.ts
      handles.ts
      anchors.ts            ← punkty SNAP na krawędziach złącza
      autosize.ts           ← auto-dopasowanie rozmiaru do elementów w pobliżu
      PropertiesPanel.tsx
    [nowy-ksztalt]/         ← dodać tu; nic innego się nie zmienia

  weld-units/
    types.ts                ← WeldUnit, WeldBeadSequenceData, WeldLayer, BeadShape
    bead-sequence.ts        ← generowanie i modyfikacja sekwencji ściegów
    WeldUnitOverlay.tsx     ← renderowanie sekwencji ściegów na canvasie

  store/
    types.ts                ← ShapeUpdate (intersection-derived), HistoryEntry
    slices/
      shapes.ts             ← ShapesSlice
      weld-units.ts         ← WeldUnitsSlice
      history.ts            ← HistorySlice
      canvas.ts             ← CanvasSlice (viewport, zoom, pan, tool mode)
      ui.ts                 ← UISlice (selection, snap, dark mode)
      document.ts           ← DocumentSlice (meta, isDirty, save state)
    use-canvas-store.ts     ← złożony Zustand store

  components/
    canvas/
      CanvasApp.tsx
      ShapeNode.tsx
      ShapeHandles.tsx      ← generyczny, registry-driven
      AnchorPoints.tsx      ← generyczny, registry-driven (tryb weld-joint)
      MultiShapeHandles.tsx
      WeldUnitHandles.tsx   ← uchwyt obrotu całego WeldUnit
      SelectionMarquee.tsx
    sidebar/
      PropertiesSidebar.tsx
      WeldJointPanel.tsx
      WeldSequencePanel.tsx ← zarządzanie warstwami i ściegami
    toolbar/
      Toolbar.tsx
      ToolButton.tsx
    project-list/
      ProjectList.tsx

  lib/
    captureGeometry.ts      ← fasada rejestru
    shapeBounds.ts          ← fasada rejestru
    snapEngine.ts           ← logika SNAP
    weldAutosize.ts         ← auto-dopasowanie weld-joint
    documentCodec.ts        ← serialize/deserialize sceny
    exportEngine.ts         ← eksport PNG/JPG
    overlapDetector.ts      ← wykrywanie nakładania weld-joint z elementami

  app/
    (auth)/
      login/page.tsx
      register/page.tsx
      reset-password/page.tsx
    (app)/
      canvas/[projectId]/page.tsx
      projects/page.tsx
    layout.tsx
    page.tsx
```

---

## 4. Typy bazowe

### `src/shapes/_base/types.ts`

```typescript
export interface Point { x: number; y: number }

export interface BaseShape {
  id: string
  type: ShapeType
  x: number; y: number
  rotation: number
  opacity: number
  fill: string
  stroke: string
  strokeWidth: number
}

export interface BoundingBox { x1: number; y1: number; x2: number; y2: number }

export interface HandleDescriptor { kind: string; x: number; y: number; cursor?: string }

export interface HandleGeometry {
  bbox: BoundingBox
  sides: HandleDescriptor[]
  scale: Point
  rotate: Point
}

export interface AnchorPoint {
  id: string
  x: number
  y: number
  direction?: number   // kąt normalnej wychodzącej, 0 = prawo
}

export interface AnchorEdge {
  id: string
  a: Point             // start odcinka (world)
  b: Point             // koniec odcinka (world)
  direction: number    // kąt normalnej zewnętrznej, 0 = prawo
}

export interface StartSnapshot { x: number; y: number; rotation: number }

export type FieldUpdate = Partial<Record<string, unknown>>
```

### `src/shapes/_base/definition.ts`

```typescript
export interface ShapeDefinition<S extends BaseShape = BaseShape> {
  type: ShapeType
  label: string
  icon: ComponentType

  create: (pos: Point) => S

  Renderer: ComponentType<{ shape: S; isSelected: boolean; isInLockedUnit: boolean }>
  PropertiesPanel: ComponentType<{ shape: S }>

  captureGeometry: (shape: S) => FieldUpdate
  getBoundingBox: (shape: S) => BoundingBox
  getWorldPoints: (shape: S) => Point[]

  getHandles: ((shape: S) => HandleGeometry) | null
  captureStart: ((shape: S) => StartSnapshot) | null
  applyHandleDrag: ((
    start: StartSnapshot,
    kind: string,
    ldx: number, ldy: number,
    startLocalPtr: Point,
    sinθ: number, cosθ: number,
  ) => FieldUpdate) | null

  anchors?: (shape: S) => AnchorPoint[]     // point-snap (sekcja 10.1)
  edges?: (shape: S) => AnchorEdge[]        // edge-snap z attachmentem (sekcja 10.2)

  validate?: (shape: S) => ValidationError[]

  toSVG?: (shape: S) => string
}

export interface ValidationError {
  field: string
  message: string
}
```

---

## 5. Rejestr kształtów

### `src/shapes/registry.ts`

```typescript
export const SHAPE_REGISTRY: Record<ShapeType, ShapeDefinition<any>> = {
  'plate':              PlateDefinition,
  'pipe-front':         PipeFrontDefinition,
  'pipe-longitudinal':  PipeLongitudinalDefinition,
  'profile-i':          ProfileIDefinition,
  'profile-c':          ProfileCDefinition,
  'profile-l':          ProfileLDefinition,
  'profile-t':          ProfileTDefinition,
  'weld-joint':         WeldJointDefinition,
}
```

**Dodanie nowego kształtu — 4 miejsca:**
1. Nowy katalog `src/shapes/[typ]/` z `types.ts`, `handles.ts`, `anchors.ts` (eksportuje `anchors()` i — jeśli kształt ma proste ścianki — `edges()`), `index.ts`, `PropertiesPanel.tsx`
2. `src/shapes/index.ts` — dodanie do unii `ShapeType`
3. `src/shapes/registry.ts` — wpis w `SHAPE_REGISTRY`
4. `src/store/types.ts` — dodanie do `AllShapeGeometry`

Żaden inny plik nie ulega modyfikacji.

---

## 6. Typy kształtów MVP

### `plate`

```typescript
interface PlateShape extends BaseShape {
  type: 'plate'
  width: number
  thickness: number
  bevelType: 'none' | 'single' | 'double'
  bevelAngleTop: number      // 0–80°, krok 0.5°
  bevelAngleBottom: number   // tylko dla 'double'
  bevelHeight: number
}
```

Anchor points (point-snap): narożniki + środki ścianek.  
Anchor edges (edge-snap): każda widoczna ścianka prostoliniowa (zależnie od typu bevelu).

### `pipe-front`

```typescript
interface PipeFrontShape extends BaseShape {
  type: 'pipe-front'
  outerRadius: number
  wallThickness: number    // constraint: < outerRadius − 1
}
```

Wizualizacja: pierścień (koło wewnątrz koła).  
Anchor points (point-snap): 4 kardynalne + środek.  
Anchor edges: brak (kształt czysto okrągły — nie uczestniczy w edge-snap jako target).  
Uchwyty: `outerRadius` skaluje uchwyt; `wallThickness` absolutna z walidacją inline.

### `pipe-longitudinal`

```typescript
interface PipeLongitudinalShape extends BaseShape {
  type: 'pipe-longitudinal'
  length: number
  outerDiameter: number
  wallThickness: number    // constraint: < outerDiameter / 2 − 1
}
```

Wizualizacja: prostokąt z osią symetrii i oznaczeniem ∅.  
Anchor points (point-snap): narożniki + środki ścianek.  
Anchor edges (edge-snap): 4 ścianki prostokąta.

### `profile-i` (analogicznie `profile-c`, `profile-l`, `profile-t`)

```typescript
interface ProfileIShape extends BaseShape {
  type: 'profile-i'
  totalHeight: number
  flangeWidth: number
  flangeThickness: number
  webThickness: number
  bevelType: 'none' | 'single' | 'double'
  bevelAngleTop: number
  bevelAngleBottom: number
  bevelHeight: number
}
```

Każdy wymiar niezależnie przeciągalny przez własny uchwyt. Walidacja geometryczna sygnalizowana inline — edycja nie jest blokowana.  
Anchor points (point-snap): środki każdej odsłoniętej ścianki profilu.  
Anchor edges (edge-snap): każda odsłonięta ścianka prostoliniowa profilu (po jednym `AnchorEdge` na segment konturu).

### `weld-joint`

```typescript
type WeldJoinType =
  | 'fillet'        // pachwinowa trójkątna
  | 'butt-square'   // czołowa prostokątna
  | 'butt-v'        // czołowa V
  | 'butt-x'        // czołowa X
  | 'butt-y'        // czołowa Y
  | 'butt-k'        // czołowa K
  | 'butt-u'        // czołowa U
  | 'spot'          // punktowa

interface WeldJointShape extends BaseShape {
  type: 'weld-joint'
  joinType: WeldJoinType
  leg1?: number           // fillet
  leg2?: number           // fillet
  angle?: number          // butt-v, butt-x, itp.
  rootGap?: number
  depth?: number
  diameter?: number       // spot
  _geometryChecksum?: string   // do walidacji dormant sequence
}
```

Przy wstawieniu: `autosize.ts` dopasowuje startowe wymiary na podstawie bounding boxów elementów w pobliżu.  
Renderowanie: proporcjonalna geometria zgodna z `joinType`.

---

## 7. Model WeldUnit

### `src/weld-units/types.ts`

```typescript
type WeldUnitState =
  | 'locked'      // elementy + złącze ruszają się jako jednostka; brak sekwencji (Konwertuj dostępne)
  | 'sequence'    // jak 'locked', ale złącze rysowane jako sekwencja ściegów (overlay)
  | 'detached'    // unit istnieje w storze (pamięć dormant), ale elementy poruszają się niezależnie

interface WeldUnit {
  id: string
  state: WeldUnitState
  elementIds: string[]                     // plate / pipe / profile
  weldJointId: string
  sequenceData: WeldBeadSequenceData | null
    // null w 'locked'
    // aktywna sekwencja (renderowana) w 'sequence'
    // dormant (do potencjalnego przywrócenia) w 'detached'; może być null jeśli unit nigdy nie był skonwertowany
  sequenceJointChecksum: string | null
    // checksum geometrii weld-joint w momencie zapisu sequenceData; null gdy sequenceData == null
}

interface WeldBeadSequenceData {
  beadShape: BeadShape
  layers: WeldLayer[]
  manualNumbering: number[][]              // [layerIndex][beadIndex] → numer wyświetlany
}

interface WeldLayer {
  id: string
  depth: number
  beadCount: number                        // min. 1
}

type BeadShape = 'rounded-triangle' | 'rounded-trapezoid'
```

Każdy `weld-joint` ma co najwyżej jeden `WeldUnit` (lookup po `weldJointId`). `WeldBeadSequenceData` NIE jest elementem `shapes[]` — żyje wyłącznie wewnątrz `WeldUnit`. `WeldUnitOverlay.tsx` renderuje sekwencję tylko gdy `state === 'sequence'`.

### Maszyna stanów

Stan `'detached'` pełni rolę „pamięci dormant" — unit istnieje, ale dla wszystkich efektów ruchu/zaznaczenia zachowuje się jak brak unitu. „Zablokuj" pojawia się ponownie gdy w stanie `'detached'` `weld-joint` znów nachodzi ≥ 2 elementy.

```
                        Zablokuj                                Konwertuj
   (brak unitu) ───────────────────────────► [state='locked'] ─────────────► [state='sequence']
        ▲                                            │  ▲                            │
        │                                            │  │                            │
        │ usunięcie                                  │  │  Zablokuj (checksum OK     │ Odblokuj
        │ weld-joint                       Odblokuj  │  │   → restore sequenceData)  │ (zapis sequenceData
        │ lub elementu                  (sequenceData│  │                            │  i sequenceJointChecksum)
        │ z elementIds                  bez zmian)   │  │  Zablokuj (inaczej         │
        │                                            │  │   → state='locked',        │
        │                                            ▼  │   sequenceData=null,       ▼
        │                                       [state='detached'] ◄──────────────────
        │                                            │
        └────────────────────────────────────────────┘
```

**Tworzenie unitu (brak unitu → `'locked'`):**
„Zablokuj" widoczne, gdy `weld-joint` nachodzi bbox-em na ≥ 2 elementy i nie istnieje unit dla tego `weldJointId`. Klik tworzy `WeldUnit` z `state='locked'`, `sequenceData=null`, `sequenceJointChecksum=null`.

**`'locked' → 'sequence'` (Konwertuj):**
Generuje świeże `WeldBeadSequenceData` z bieżącej geometrii `weld-joint`. `sequenceJointChecksum = checksum(weldJoint)`.

**`'sequence' → 'detached'` (Odblokuj z sekwencji):**
`state='detached'`. `sequenceData` i `sequenceJointChecksum` pozostają nietknięte — to one zasilają potencjalne przywrócenie. Elementy i złącze odzyskują niezależność ruchu, ale unit zostaje w storze.

**`'locked' → 'detached'` (Odblokuj bez konwersji):**
`state='detached'`. `sequenceData` i `sequenceJointChecksum` pozostają `null` (żadna sekwencja nigdy nie istniała).

**`'detached' → 'sequence' | 'locked'` (Zablokuj ponowne):**
Wymaga, by `weld-joint` ponownie nachodził ≥ 2 elementy.
- `sequenceData != null` AND `checksum(currentWeldJoint) === sequenceJointChecksum` → `state='sequence'` (przywrócenie 1:1, sekwencja widoczna natychmiast, bez przycisku Konwertuj).
- W przeciwnym razie → `state='locked'`, `sequenceData=null`, `sequenceJointChecksum=null` (świeży start; pojawia się Konwertuj).

**Zniszczenie unitu:** usunięcie `weld-joint` lub któregokolwiek elementu z `elementIds` kasuje unit wraz z dormant. Brak osobnej akcji „skasuj pamięć dormant" — naturalna ścieżka to modyfikacja geometrii złącza w stanie `'detached'` przed kolejnym Zablokuj.

**Niezmiennik geometrii w `'sequence'` i `'locked'`:** w obu tych stanach parametry `weld-joint` (oraz parametry powiązanych elementów) są tylko do odczytu w panelu właściwości. Dzięki temu `sequenceJointChecksum` zapisany w momencie odblokowania zawsze odpowiada geometrii sprzed odblokowania.

### Wykrywanie nakładania (`src/lib/overlapDetector.ts`)

Nakładanie = niepuste przecięcie bounding boxów `weld-joint` i elementu (z uwzględnieniem rotacji przez transformację punktów). Sprawdzane na każdym pointerup `weld-joint` i każdym pointerup elementu w stanach `'detached'` lub gdy unit jeszcze nie istnieje — wynik decyduje o widoczności przycisku „Zablokuj".

### Przyciski akcji

| Sytuacja | Widoczne przyciski |
|---|---|
| Brak unitu, overlap ≥ 2 | „Zablokuj" |
| Brak unitu, overlap < 2 | (brak) |
| `state='locked'` | „Konwertuj", „Odblokuj" |
| `state='sequence'` | „Odblokuj" |
| `state='detached'`, overlap ≥ 2 | „Zablokuj" |
| `state='detached'`, overlap < 2 | (brak — unit pozostaje w pamięci) |

### Zachowanie ruchu i zaznaczenia

| Stan | Drag elementu | Drag weld-joint | Edycja parametrów | Uchwyt obrotu |
|---|---|---|---|---|
| Brak unitu / `'detached'` | przesuwa pojedynczy element | przesuwa pojedyncze złącze | dostępna per element/złącze | per element |
| `'locked'` / `'sequence'` | przesuwa cały unit | przesuwa cały unit | tylko do odczytu | na poziomie unitu, obraca całość |

Pozostałe reguły dla `'locked'` / `'sequence'`:
- Kliknięcie → zaznaczany fizycznie kliknięty kształt; otwierany odpowiedni panel właściwości (read-only dla pól zablokowanych).
- Marquee obejmujące WeldUnit → zaznacza unit jako całość.
- Multi-select wielu unitów (`'locked'` / `'sequence'`) → drag przesuwa wszystkie.

W stanie `'detached'` unit nie wpływa na zaznaczenie ani ruch — interfejs traktuje elementy i złącze jak niezależne kształty.

### Generowanie sekwencji (`src/weld-units/bead-sequence.ts`)

1. Z geometrii `weld-joint` obliczana liczba warstw i ściegów per warstwa.
2. Ściegi równomiernie rozmieszczone w warstwie.
3. Numeracja: 1, 2, 3… od dołu do góry, od lewej do prawej.
4. Użytkownik może ręcznie zmieniać numery w `WeldSequencePanel`.

Operacje (wszystkie cofalne przez Undo, dostępne wyłącznie gdy `state === 'sequence'`):
- Dodaj / usuń ścieg w warstwie [+] / [−] (min. 1 ścieg)
- Dodaj / usuń warstwę (min. 1 warstwa)
- Kształt ściegu: globalny dla całej sekwencji

---

## 8. Store (Zustand + Immer)

### Złożenie

```typescript
type CanvasStore =
  ShapesSlice & WeldUnitsSlice & HistorySlice &
  CanvasSlice & UISlice & DocumentSlice

export const useCanvasStore = create<CanvasStore>()(
  immer((...a) => ({
    ...createShapesSlice(...a),
    ...createWeldUnitsSlice(...a),
    ...createHistorySlice(...a),
    ...createCanvasSlice(...a),
    ...createUISlice(...a),
    ...createDocumentSlice(...a),
  }))
)
```

### ShapesSlice

```typescript
interface ShapesSlice {
  shapes: Shape[]   // z-index = kolejność

  addShape: (shape: Shape) => void
  // sprawdza limit planu; push HistoryEntry { kind: 'shape', before: null, after: full }

  removeShape: (id: string) => void
  // push HistoryEntry { kind: 'shape', before: full, after: null }
  // jeśli kształt to weld-joint lub należy do elementIds aktywnego WeldUnit:
  //   wywołuje removeUnit z tym samym groupId — undo przywraca obie rzeczy atomowo

  updateShapeTransient: (id: string, patch: ShapeUpdate) => void
  // live drag / live edit; BEZ historii

  commitShapeUpdate: (id: string, before: ShapeUpdate, after: ShapeUpdate) => void
  // push HistoryEntry { kind: 'shape', before: diff, after: diff }

  reorderShape: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void
  mirrorShape: (id: string, axis: 'horizontal' | 'vertical') => void
  // ↑ wewnętrznie używają commitShapeUpdate — historia obsłużona automatycznie
}
```

### WeldUnitsSlice

```typescript
interface WeldUnitsSlice {
  weldUnits: WeldUnit[]

  // Tworzy nowy unit (state='locked') albo przywraca istniejący 'detached':
  // - jeśli istnieje unit dla weldJointId w 'detached' AND sequenceData != null
  //   AND checksum(currentJoint) === sequenceJointChecksum → state='sequence' (restore)
  // - jeśli istnieje unit w 'detached' z mismatchem → state='locked',
  //   sequenceData=null, sequenceJointChecksum=null
  // - jeśli unit nie istnieje → utwórz z state='locked'
  lockUnit: (weldJointId: string, elementIds: string[]) => void

  // 'sequence' → 'detached' (sequenceData i sequenceJointChecksum zachowane jako dormant)
  // 'locked'   → 'detached' (sequenceData/checksum pozostają null)
  unlockUnit: (unitId: string) => void

  // 'locked' → 'sequence' (generuje świeżą sekwencję, ustawia sequenceJointChecksum)
  convertToSequence: (unitId: string) => void

  addBeadToLayer: (unitId: string, layerIndex: number) => void
  removeBeadFromLayer: (unitId: string, layerIndex: number) => void
  addLayer: (unitId: string) => void
  removeLayer: (unitId: string, layerIndex: number) => void
  setBeadShape: (unitId: string, shape: BeadShape) => void
  setBeadNumber: (unitId: string, layerIndex: number, beadIndex: number, n: number) => void

  // Kasuje unit całkowicie (wraz z dormant). Wywoływane automatycznie
  // przy usunięciu weld-joint lub któregokolwiek elementu z elementIds.
  removeUnit: (unitId: string) => void
}
```

Operacje mutujące sekwencję (`addBeadToLayer`, `removeBeadFromLayer`, `addLayer`, `removeLayer`, `setBeadShape`, `setBeadNumber`) są dozwolone wyłącznie gdy `state === 'sequence'`. Próba wywołania w innym stanie to błąd programistyczny.

**Historia:** każda operacja `WeldUnitsSlice` (oprócz wewnętrznych readów) push'uje `HistoryEntry { kind: 'weld-unit' }` — wzorzec snapshot-mutate-snapshot:

```typescript
function withWeldUnitHistory(unitId: string, mutation: () => void) {
  const before = snapshotUnit(unitId)   // null jeśli unit jeszcze nie istnieje
  mutation()
  const after = snapshotUnit(unitId)    // null jeśli unit właśnie usunięty
  if (!equalsSnapshot(before, after)) {
    pushHistory({ kind: 'weld-unit', unitId, before, after })
  }
}
```

`snapshotUnit` zwraca `WeldUnitSnapshot | null`. Mapowanie operacji na zawartość wpisu:

| Operacja | `before` | `after` |
|---|---|---|
| `lockUnit` (nowy unit) | `null` | snapshot `'locked'` |
| `lockUnit` (z `'detached'`) | snapshot `'detached'` | snapshot `'locked'` lub `'sequence'` |
| `unlockUnit` | snapshot `'locked'`/`'sequence'` | snapshot `'detached'` |
| `convertToSequence` | snapshot `'locked'` | snapshot `'sequence'` (fresh data) |
| `addBeadToLayer` / `removeBeadFromLayer` | snapshot przed | snapshot po |
| `addLayer` / `removeLayer` | snapshot przed | snapshot po |
| `setBeadShape` / `setBeadNumber` | snapshot przed | snapshot po |
| `removeUnit` | snapshot przed | `null` |

Gdy `removeUnit` jest wywołane kaskadowo z `removeShape`, oba wpisy dostają wspólny `groupId` — jedno Ctrl+Z przywraca i kształt, i unit (z dormant).

### HistorySlice

```typescript
type WeldUnitSnapshot = Pick<
  WeldUnit,
  'weldJointId' | 'state' | 'sequenceData' | 'sequenceJointChecksum' | 'elementIds'
>

type HistoryEntry = (
  | { kind: 'shape';     shapeId: string; before: ShapeUpdate | null;      after: ShapeUpdate | null }
  | { kind: 'weld-unit'; unitId: string;  before: WeldUnitSnapshot | null; after: WeldUnitSnapshot | null }
) & {
  groupId?: string   // wpisy z tym samym groupId są cofane / redowane atomowo jednym Ctrl+Z
}

interface HistorySlice {
  history: HistoryEntry[]
  historyIndex: number

  pushHistory: (entry: HistoryEntry) => void
  undo: () => void                       // cofa pojedynczy wpis lub całą grupę z tym samym groupId
  redo: () => void
}
```

**Konwencja `before` / `after`:**
- `before === null` → wpis reprezentuje utworzenie; undo usuwa, redo tworzy.
- `after === null` → wpis reprezentuje usunięcie; undo tworzy, redo usuwa.
- Oba `!= null` → update; undo aplikuje `before`, redo aplikuje `after`.

Dla `kind: 'shape'`: `ShapeUpdate` to `Partial<AllShapeGeometry & { type: ShapeType }>` — przy create/delete musi zawierać komplet pól geometrycznych + `type`; przy update wystarczą zmienione pola.

Dla `kind: 'weld-unit'`: `WeldUnitSnapshot` to wszystkie pola definiujące tożsamość i logiczny stan unitu, z pominięciem `id` (`id` przechowywane w `unitId` na wpisie).

Max 100 wpisów (FIFO drop przy przepełnieniu). Nie persystowana do Supabase.

### CanvasSlice

```typescript
interface CanvasSlice {
  stageX: number; stageY: number
  stageScale: number
  canvasWidth: number; canvasHeight: number
  toolMode: 'select' | 'hand' | 'weld-joint'

  panBy: (dx: number, dy: number) => void
  zoomTo: (scale: number, focalPoint: Point) => void
  setToolMode: (mode: ToolMode) => void
  setCanvasSize: (w: number, h: number) => void
}
```

### UISlice

```typescript
interface UISlice {
  selectedIds: string[]
  snapEnabled: boolean
  attachment: SnapAttachment | null     // aktywny edge-snap attachment, patrz sekcja 10.2
  isDarkMode: boolean
  locale: 'pl' | 'en'

  setSelection: (ids: string[]) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  toggleSnap: () => void
  setSnapTemporary: (enabled: boolean) => void
  setAttachment: (a: SnapAttachment | null) => void
  setDarkMode: (dark: boolean) => void
  setLocale: (locale: 'pl' | 'en') => void
}
```

### DocumentSlice

```typescript
interface DocumentSlice {
  documentId: string | null
  documentName: string
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null

  setDocumentName: (name: string) => void
  saveDocument: () => Promise<void>
  loadDocument: (id: string) => Promise<void>
  createDocument: (name: string) => Promise<void>
}
```

### ShapeUpdate (`src/store/types.ts`)

```typescript
type AllShapeGeometry =
  Omit<PlateShape,            'id' | 'type'> &
  Omit<PipeFrontShape,        'id' | 'type'> &
  Omit<PipeLongitudinalShape, 'id' | 'type'> &
  Omit<ProfileIShape,         'id' | 'type'> &
  Omit<ProfileCShape,         'id' | 'type'> &
  Omit<ProfileLShape,         'id' | 'type'> &
  Omit<ProfileTShape,         'id' | 'type'> &
  Omit<WeldJointShape,        'id' | 'type'>

export type ShapeUpdate = Partial<AllShapeGeometry & { type: ShapeType }>
```

---

## 9. Canvas i nawigacja

### Struktura Konva

```tsx
<Stage width={viewportWidth} height={viewportHeight} pixelRatio={window.devicePixelRatio}>
  <Layer>
    {shapes.map((s) => <ShapeNode key={s.id} shape={s} />)}
    {weldUnits.map((u) => <WeldUnitOverlay key={u.id} unit={u} />)}
  </Layer>
  <Layer>  {/* kontrolki — zawsze na wierzchu */}
    <ShapeHandles />
    <WeldUnitHandles />
    <MultiShapeHandles />
    <AnchorPoints />      {/* widoczne w trybie 'weld-joint' */}
    <SelectionMarquee />
  </Layer>
</Stage>
```

### Tryby kursora

| Tryb | Zachowanie | Skrót |
|---|---|---|
| `select` | drag na pustym → marquee; drag na elemencie → move | `V` |
| `hand` | drag → pan | `H` |
| `weld-joint` | klik → wstawia weld-joint | `W` |

### Pan i zoom

- Scroll → pan
- Scroll + Ctrl/Cmd → zoom (punkt ogniskowy = kursor)
- Touch 1 palec → pan; pinch → zoom
- Viewport ograniczony do granic obszaru roboczego (`canvasWidth × canvasHeight`)
- Widok startowy po wczytaniu: zoom-to-fit, padding ≤ 40 px
- Pinch-to-zoom: śledzenie dwóch `pointerId` w `CanvasApp.tsx`. Nie używać `gesturestart`/`gesturechange`.

### Obsługa dotykowa

| Gest | Akcja |
|---|---|
| 1 tap na pustym | pan |
| 2 taps na pustym | aktywuje marquee |
| 2 taps na elemencie | inicjuje przesuwanie (jeśli element nie jest w locked WeldUnit) |
| 1 tap na zaznaczonym | inicjuje przesuwanie |
| 1 tap na uchwycie | aktywuje uchwyt |
| Pinch | zoom |

Hit area uchwytów: 20 px (touch) / 8 px (desktop). Detekcja: `navigator.maxTouchPoints > 0`.

---

## 10. System SNAP

System SNAP działa w dwóch niezależnych, **współistniejących** trybach. Oba tryby sterowane są jednym togglem (`UISlice.snapEnabled`) i tym samym tymczasowym wyłączeniem (`Alt`).

| Tryb | Cel | Stan między klatkami | Wybierany przez |
|---|---|---|---|
| **10.1 Point-snap** | Wstawianie `weld-joint`, wyrównywanie punktowe | Bezstanowy (per-frame) | Tryb `weld-joint`; tryb `select` przy braku kandydata edge-snap |
| **10.2 Edge-snap z attachmentem** | Przesuwanie elementów po równoległej ściance („na szynach") | Stan w `UISlice.attachment` | Tryb `select` przy dragu elementu/grupy/WeldUnit |

Dane wejściowe pochodzą z `SHAPE_REGISTRY`: `anchors()` zasila tryb 10.1, `edges()` zasila tryb 10.2. Przeciągany kształt i jego grupa (multi-select / WeldUnit) są wykluczone z listy kandydatów.

### 10.1 Point-snap

Tryb dyskretny: punkt referencyjny (kursor wstawiania `weld-joint`, narożnik bbox przy wyrównywaniu) przyciąga się do najbliższego dyskretnego `AnchorPoint`.

- Próg: `POINT_SNAP_THRESHOLD = 8 px` (przestrzeń canvasu)
- Brak histerezy, brak stanu — czysta projekcja per frame
- Wizualizacja: `AnchorPoints.tsx` renderuje diamenty w trybie `weld-joint`

### 10.2 Edge-snap z attachmentem

Tryb krawędziowy z trwałym przyklejeniem. Aktywny przy przesuwaniu elementu / grupy / WeldUnit w trybie `select`. Działa wyłącznie między **równoległymi** krawędziami.

#### Model attachmentu

```typescript
interface SnapAttachment {
  draggedShapeId: string        // pojedynczy element lub root grupy / WeldUnit
  draggedEdgeId: string
  targetShapeId: string
  targetEdgeId: string
  param: number                 // pozycja punktu kontaktu wzdłuż target edge, 0..1
}
```

Stan trzymany w `UISlice.attachment`. Resetowany na `pointerup` lub przy `Alt`/wyłączeniu snapu.

#### Stałe

```typescript
const POINT_SNAP_THRESHOLD = 8       // px, point-snap (10.1)
const ATTACH_THRESHOLD     = 8       // px, edge-snap attach
const RELEASE_THRESHOLD    = 16      // px, edge-snap release (histereza)
const PARALLEL_TOLERANCE   = 0.087   // sin(5°)
```

`RELEASE_THRESHOLD > ATTACH_THRESHOLD` zapewnia histerezę zapobiegającą drganiu attach/release przy ruchu blisko progu.

#### Faza ATTACH (gdy `attachment === null`)

1. Dla każdej pary `(e_drag, e_target)` z krawędzi przeciąganego × krawędzi pozostałych elementów:
   - **Równoległość:** `|sin(angle(e_drag) − angle(e_target))| < PARALLEL_TOLERANCE`
   - **Przekrycie:** rzutuj końce `e_drag` na linię nośną `e_target`; wymagaj `overlap > 0`
   - **Odległość prostopadła** `d` mierzy odsunięcie linii nośnych
2. Wybierz parę o najmniejszym `d` przy `d < ATTACH_THRESHOLD`
3. Zatrzaśnij: przesuń element prostopadle do `e_target`, tak aby krawędzie się stykały
4. Zapisz `attachment`; oblicz `param` jako pozycję rzutu środka `e_drag` na `e_target`

#### Faza SLIDE (gdy `attachment !== null`)

Ruch wskaźnika (`Δp`) rozkładany na bazę krawędzi:

- `Δ_along` — komponenta wzdłuż `e_target`
- `Δ_perp` — komponenta prostopadła do `e_target`

Algorytm:

1. Akumuluj `Δ_perp` od momentu ostatniego attachu: `perp_accum += Δ_perp`
2. Jeżeli `|perp_accum| < RELEASE_THRESHOLD`:
   - przesuń element wyłącznie o `Δ_along` (pozycja prostopadła zatrzaśnięta)
   - aktualizuj `attachment.param` o przesunięcie wzdłuż krawędzi
3. Jeżeli `|perp_accum| ≥ RELEASE_THRESHOLD`:
   - `attachment = null`, `perp_accum = 0`
   - kontynuuj jako swobodny drag (na kolejnej klatce może powstać nowy attach do innej krawędzi)

#### Multi-select i WeldUnit

Przy dragu grupy lub WeldUnit krawędzie kandydujące pochodzą **wyłącznie z zewnętrznego konturu** zbiorczego (nie z wewnętrznych krawędzi elementów grupy). Wszystkie elementy grupy są wykluczone z listy targetów.

#### Wizualizacja

- Stan ATTACHED: krawędź `e_target` podświetlona akcentem (linia 2 px) na dedykowanej warstwie kontrolek
- Brak diamentów point-snap w trybie `select` (są zarezerwowane dla trybu `weld-joint`)

### 10.3 Sterowanie (wspólne)

- Toggle button w toolbarze (`snapEnabled`); podświetlony = aktywny
- Przytrzymanie `Alt`: tymczasowe wyłączenie obu trybów; zwolnienie przywraca poprzedni stan
- Wyłączenie snapu lub `Alt` w trakcie attachu → `attachment = null` natychmiast

### 10.4 Kontrakt `src/lib/snapEngine.ts`

```typescript
export function findPointSnap(
  source: Point,
  candidates: AnchorPoint[],
  threshold: number,
): AnchorPoint | null

export function findEdgeAttachment(
  draggedEdges: AnchorEdge[],
  targetEdges: { shapeId: string; edges: AnchorEdge[] }[],
  attachThreshold: number,
  parallelTolerance: number,
): SnapAttachment | null

export function applySlide(
  attachment: SnapAttachment,
  targetEdge: AnchorEdge,
  pointerDelta: Point,
  perpAccum: number,
  releaseThreshold: number,
): { delta: Point; nextPerpAccum: number; release: boolean }
```

Wszystkie funkcje czyste — testowalne bez Konvy ani store'u.

---

## 11. Historia operacji (Undo/Redo)

`HistoryEntry` (sekcja 8) to dyskryminowana unia: `kind: 'shape'` i `kind: 'weld-unit'`. Każdy wpis ma snapshoty `before` / `after`; `null` na którymkolwiek końcu oznacza odpowiednio utworzenie (`before=null`) lub usunięcie (`after=null`). Snapshoty są pełne (nie diffy) dla create/delete oraz dla całej rodziny `weld-unit`; dla `commitShapeUpdate` to diff/diff.

**Co trafia do historii:**

| Slice / operacja | Rodzaj wpisu |
|---|---|
| `addShape` | `shape`, `before=null` / `after=full` |
| `removeShape` | `shape`, `before=full` / `after=null` (+ `groupId` jeśli kaskaduje na unit) |
| `commitShapeUpdate` | `shape`, diff / diff |
| `mirrorShape`, `reorderShape` | `shape` (poprzez `commitShapeUpdate`) |
| `lockUnit` (nowy unit) | `weld-unit`, `before=null` / `after=snapshot('locked')` |
| `lockUnit` (z `'detached'`) | `weld-unit`, `before=snapshot('detached')` / `after=snapshot('locked' \| 'sequence')` |
| `unlockUnit` | `weld-unit`, oba snapshoty |
| `convertToSequence` | `weld-unit`, `before=snapshot('locked')` / `after=snapshot('sequence')` z fresh data |
| `addBeadToLayer`, `removeBeadFromLayer` | `weld-unit`, oba snapshoty |
| `addLayer`, `removeLayer` | `weld-unit`, oba snapshoty |
| `setBeadShape`, `setBeadNumber` | `weld-unit`, oba snapshoty |
| `removeUnit` (kaskada z `removeShape`) | `weld-unit`, `before=full` / `after=null`, `groupId` współdzielony z `shape-remove` |

**Co NIE trafia do historii:**
- `updateShapeTransient` — live drag / live edit; snapshot dopiero w `commitShapeUpdate` na koniec interakcji.
- Operacje viewportowe (`panBy`, `zoomTo`), zaznaczenie (`setSelection`), toggle SNAP, dark mode, locale, save state.

**Atomowe grupy (`groupId`):** wpisy z tym samym `groupId` są cofane / redowane jednym Ctrl+Z. Główny use case: usunięcie `weld-joint` lub elementu należącego do unitu — `removeShape` push'uje wpis `shape` i pociąga `removeUnit` (wpis `weld-unit`), oba z tym samym `groupId`. Jedno Ctrl+Z przywraca kształt **i** unit z całym dormant. Multi-shape moves nadal generują po jednym wpisie na kształt bez `groupId` (zachowanie pre-existing — może otrzymać grupowanie w przyszłej iteracji bez zmiany typu `HistoryEntry`).

**Persistencja i limity:**
- Po każdym `pushHistory`: synchroniczny zapis pełnej sceny + historii do `localStorage`.
- Max 100 wpisów; przy przepełnieniu drop najstarszych (FIFO).
- Historia NIE trafia do Supabase (sekcja 13).

**Skróty:**
- Undo: `Ctrl+Z` / `Cmd+Z`
- Redo: `Ctrl+Y` / `Ctrl+Shift+Z` / `Cmd+Y` / `Cmd+Shift+Z`

---

## 12. Eksport

### Proces (`src/lib/exportEngine.ts`)

1. Ukryć kontrolki (handles, marquee, anchor points)
2. Jeśli kadrowanie: bounding box wszystkich elementów + padding 20 px
3. Nałożyć warstwę opisową (jeśli włączona)
4. Nałożyć watermark (jeśli plan Guest lub Free)
5. `stage.toDataURL()` → PNG lub JPG

### Opcje

- **Obszar:** pełny canvas lub kadrowanie do bounding box zawartości (padding 20 px)
- **Warstwa opisowa:** numery ściegów rysowane na każdym ściegu + tabela legendy poniżej rysunku

### Watermark

Plany Guest i Free: powtarzający się tekst po przekątnej, pokrywający całą powierzchnię, opacity 25%. Renderowany jako ostatnia warstwa.

### Walidacja

`shapes.length === 0 && weldUnits.length === 0` → blokada eksportu z toastem.

---

## 13. Trwałość danych

### localStorage (autozapis)

Klucz: `'welderdoc_autosave'`. Zapis synchronicznie przy każdym `commitShapeUpdate` i operacji WeldUnit.

```typescript
interface LocalStorageSnapshot {
  schemaVersion: number
  scene: CanvasDocument
  history: HistoryEntry[]
  historyIndex: number
  savedAt: string   // ISO
}
```

Przy starcie: klucz istnieje i `schemaVersion` zgodna → przywróć scenę i historię.

`QuotaExceededError`: przyciąć historię do 50 wpisów i ponowić; przy dalszym błędzie → toast z rekomendacją zapisu w chmurze.

### Supabase (zapis świadomy)

Inicjowany wyłącznie akcją użytkownika. PATCH na `documents.data`.

```typescript
interface CanvasDocument {
  schemaVersion: number
  canvasWidth: number
  canvasHeight: number
  shapes: Shape[]
  weldUnits: WeldUnit[]
}
```

Historia operacji nie jest zapisywana do Supabase.

### Document Codec (`src/lib/documentCodec.ts`)

```typescript
encodeDocument(storeState): CanvasDocument
decodeDocument(doc: CanvasDocument): { shapes, weldUnits, canvasWidth, canvasHeight }
```

Jedyne miejsce definiujące format serializacji. Przy decode: sprawdzenie `schemaVersion`; jeśli starsza — uruchomienie funkcji migracyjnej.

Kod migracyjny pisany przy każdej realnej zmianie schematu; stare dokumenty muszą być upgradowne bez utraty danych.

---

## 14. Uwierzytelnianie i plany

### Supabase Auth

- Rejestracja: email + hasło (format email, min. 8 znaków)
- Logowanie, wylogowanie, reset przez email (link ważny min. 1 h)
- Sesja persystowana między odświeżeniami
- Rejestracja: obowiązkowy checkbox zgody; wersja zgody zapisywana w `user_profiles`

### Tryb gościa

- Aplikacja dostępna bez konta
- Autozapis wyłącznie w localStorage
- Baner CTA
- Limit 3 elementów łącznie (prymitywy + weld-joint); 4. element blokowany z toastem CTA

### Migracja gościa

Po zalogowaniu: jeśli `'welderdoc_autosave'` istnieje → automatyczna migracja do Supabase jako nowy projekt (bez akcji użytkownika). Toast potwierdzający po pomyślnej migracji.

### Plany

| Plan | Elementy na scenie | Projekty cloud | Watermark |
|---|---|---|---|
| Guest | max 3 | 0 | tak |
| Free | max 3 | 1 | tak |
| Pro | bez limitu | bez limitu | nie |

Płatności: Paddle. Ceny: Pro Monthly 49 PLN / Pro Annual 399 PLN.  
Logika limitów: w `ShapesSlice.addShape`; plan pobierany z `user_profiles` przy starcie sesji.

---

## 15. Schemat bazy danych

```sql
CREATE TABLE documents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID        REFERENCES auth.users NOT NULL,
  name           TEXT        NOT NULL DEFAULT 'Nowy projekt',
  data           JSONB       NOT NULL,
  schema_version INT         NOT NULL DEFAULT 1,
  share_token    TEXT        UNIQUE,         -- zarezerwowane (post-MVP)
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner only" ON documents USING (owner_id = auth.uid());

CREATE TABLE user_profiles (
  id              UUID    PRIMARY KEY REFERENCES auth.users,
  plan            TEXT    NOT NULL DEFAULT 'free',  -- 'free' | 'pro'
  paddle_customer TEXT,
  consent_version TEXT,
  consent_at      TIMESTAMPTZ,
  locale          TEXT    DEFAULT 'pl'
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self only" ON user_profiles USING (id = auth.uid());
```

Limit projektów Free: `SELECT COUNT(*) FROM documents WHERE owner_id = auth.uid()` przed zapisem.

---

## 16. API (Next.js Route Handlers)

Operacje CRUD dokumentów i auth: Supabase client SDK bezpośrednio (Row Level Security).  
Route Handlers tylko dla operacji wymagających server-side secret:

```
POST  /api/paddle/webhook    ← aktualizacja planu po płatności
GET   /api/health
```

---

## 17. Internacjonalizacja

Biblioteka: `next-intl`.

```
src/messages/
  pl.json
  en.json
```

Lokalizacja: ustawienia przeglądarki przy pierwszej wizycie → zapis w localStorage i `user_profiles.locale`. Przełącznik PL/EN w UI.  
Zero hardcoded stringów w komponentach — wszystkie teksty w plikach messages.

---

## 18. CI/CD i deployment

```
GitHub Actions
  ├── on: pull_request
  │     ├── lint (ESLint, tsc --noEmit)
  │     ├── test:unit (Vitest)
  │     └── test:e2e (Playwright — headless Chromium)
  └── on: push → main
        ├── build (next build)
        └── deploy → Vercel (production)
```

- **Preview:** Vercel preview URL dla każdego PR
- **Production:** Vercel + Supabase EU Frankfurt

Zmienne środowiskowe:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY      ← tylko server-side
PADDLE_WEBHOOK_SECRET
NEXT_PUBLIC_APP_URL
```

---

## 19. Dodanie nowego typu kształtu

Przykład: `profile-u`.

1. `src/shapes/profile-u/` — `types.ts`, `handles.ts`, `anchors.ts` (eksportuje `anchors()` + `edges()`), `index.ts`, `PropertiesPanel.tsx`
2. `src/shapes/index.ts` — `'profile-u'` do unii `ShapeType`
3. `src/shapes/registry.ts` — `'profile-u': ProfileUDefinition`
4. `src/store/types.ts` — `Omit<ProfileUShape, 'id' | 'type'>` do `AllShapeGeometry`

Żaden inny plik nie ulega modyfikacji — `ShapeHandles`, `PropertiesSidebar`, `snapEngine` (point + edge), `documentCodec`, `exportEngine` działają automatycznie. `edges()` jest opcjonalne; brak implementacji oznacza, że kształt nie uczestniczy w edge-snap jako target.

---

## 20. Znane ryzyka techniczne

### Konva na tablet / stylus

- `pointer*` events wszędzie; `setPointerCapture` przy starcie dragu
- Hit area: 20 px (touch) / 8 px (desktop)
- `pixelRatio={window.devicePixelRatio}` na `<Stage>`
- Przetestować na fizycznym tablecie Wacom przed oddaniem do użytkowników

### Złożoność maszyny stanów WeldUnit

- Cała logika izolowana w `WeldUnitsSlice` i `bead-sequence.ts`
- Checksum geometrii złącza jako deterministyczny warunek przywrócenia dormant sequence
- Testy jednostkowe dla każdego przejścia stanów

### Auto-sizing weld-joint

- `autosize.ts` jest pure function → łatwa do testowania
- Fallback na stałe domyślne wartości gdy algorytm nie może dopasować
- Użytkownik może ręcznie korygować uchwytami

### Wydajność przy dużych scenach

- `updateShapeTransient` nie zapisuje do historii ani localStorage — minimalna praca przy drag
- Przy > 50 elementach: rozważyć `cache()` na złożonych kształtach profili

---

## 21. Ściągawka

```
ShapeType (closed union)
  └─► SHAPE_REGISTRY[type] → ShapeDefinition<S>
        ├── create(pos)              → nowy S
        ├── Renderer                 → Konva Group
        ├── PropertiesPanel          → sidebar form
        ├── captureGeometry(s)       → FieldUpdate
        ├── getBoundingBox(s)        → BoundingBox
        ├── getWorldPoints(s)        → Point[]
        ├── getHandles(s)            → HandleGeometry | null
        ├── captureStart(s)          → StartSnapshot | null
        ├── applyHandleDrag(…)       → FieldUpdate | null
        ├── anchors?(s)              → AnchorPoint[]   (point-snap)
        ├── edges?(s)                → AnchorEdge[]    (edge-snap target)
        └── validate?(s)             → ValidationError[]

Store (Zustand + Immer)
  ├── shapes: Shape[]           z-index = kolejność tablicy
  ├── weldUnits: WeldUnit[]
  ├── history: HistoryEntry[]   max 100, localStorage only
  │     kind: 'shape' | 'weld-unit'  before/after | null = create/delete
  │     groupId? → atomowy multi-entry undo (np. shape-remove + weld-unit-remove)
  ├── canvas                    viewport, zoom, toolMode
  ├── ui                        selection, snap, attachment, darkMode
  └── document                  name, isDirty, save state

WeldUnit (state: 'locked' | 'sequence' | 'detached')
  (brak unitu) ──Zablokuj──► locked ──Konwertuj──► sequence
                              │ ▲                     │
                              │ │                     │
                              │ │  Zablokuj           │ Odblokuj
                              │ │  (checksum OK       │ (zapis sequenceData
                              │ │   → sequence)       │  + sequenceJointChecksum)
                              │ │                     ▼
                              └─┴────── detached ◄────┘
                                Odblokuj (locked → detached, sequenceData=null)

  Trigger Zablokuj  : bbox overlap weld-joint × ≥ 2 elementy
  detached          : unit żyje w storze, ale ruch elementów niezależny (UI jak brak unitu)
  Restore dormant   : tylko gdy checksum(currentJoint) == sequenceJointChecksum
  Zniszczenie unitu : usunięcie weld-joint lub elementu z elementIds

Canvas (Konva)
  Layer 1: shapes + WeldUnit overlays   [z-index = kolejność shapes[]]
  Layer 2: handles, WeldUnitHandles, marquee, anchors   [zawsze na wierzchu]

SNAP (dwa tryby współistnieją)
  10.1 Point-snap          : anchors() → AnchorPoint, próg 8 px, bez stanu
                             tryb 'weld-joint' + wyrównywanie punktowe
  10.2 Edge-snap (sticky)  : edges() → AnchorEdge, attach 8 px / release 16 px (histereza)
                             równoległość ścian + slide po krawędzi target
                             stan: UISlice.attachment, reset na pointerup

Persistence
  localStorage : scena + historia → odtwarzanie przy starcie
  Supabase     : JSONB snapshot przy świadomym zapisie, bez historii

Nowy kształt → 4 miejsca:
  src/shapes/[typ]/      nowy katalog
  src/shapes/index.ts    +1 do ShapeType
  src/shapes/registry.ts +1 do SHAPE_REGISTRY
  src/store/types.ts     +1 do AllShapeGeometry
```
