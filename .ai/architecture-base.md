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

  anchors?: (shape: S) => AnchorPoint[]     // punkty SNAP

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
1. Nowy katalog `src/shapes/[typ]/` z `types.ts`, `handles.ts`, `anchors.ts`, `index.ts`, `PropertiesPanel.tsx`
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

Anchor points: narożniki + środki każdej ściany (6 punktów).

### `pipe-front`

```typescript
interface PipeFrontShape extends BaseShape {
  type: 'pipe-front'
  outerRadius: number
  wallThickness: number    // constraint: < outerRadius − 1
}
```

Wizualizacja: pierścień (koło wewnątrz koła).  
Anchor points: 4 kardynalne + środek.  
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
Anchor points: krawędzie + środki ścianek.

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
Anchor points: środki każdej odsłoniętej ścianki profilu.

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
interface WeldUnit {
  id: string
  elementIds: string[]                     // plate / pipe / profile
  weldJointId: string
  isLocked: boolean
  dormantSequenceData: WeldBeadSequenceData | null
  lockedJointChecksum: string | null       // checksum geometrii złącza przy ostatnim lock
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

`WeldBeadSequenceData` NIE jest elementem `shapes[]` — przechowywana wyłącznie w `WeldUnit`, renderowana przez `WeldUnitOverlay.tsx`.

### Maszyna stanów

```
          ┌───────────┐
          │   FREE    │
          │ (elementy │
          │niezależne)│
          └─────┬─────┘
   "Zablokuj"   │  (weld-joint bbox overlap ≥ 2 elementy)
                ▼
          ┌───────────┐      "Konwertuj"     ┌──────────────┐
          │  LOCKED   │────────────────────► │   SEQUENCE   │
          │           │ ◄─────"Odblokuj"──── │              │
          └───────────┘  (sequence→dormant)  └──────────────┘
                ▲                                    │
                └────────"Zablokuj"──────────────────┘
                    (checksum OK → przywróć dormant)
```

**FREE → LOCKED:** `weld-joint` nachodzi bbox-em na ≥ 2 elementy.

**LOCKED → SEQUENCE:** generuje `WeldBeadSequenceData` z geometrii `weld-joint`.

**SEQUENCE → LOCKED (odblokowanie):** sekwencja trafia do `dormantSequenceData`; zapisywany `lockedJointChecksum`.

**LOCKED → SEQUENCE (ponowne zablokowanie):**
- `dormantSequenceData !== null` AND checksum zgodny → przywróć dormant sequence.
- Geometria złącza zmieniona → `dormantSequenceData = null`, konieczna konwersja od nowa.

### Wykrywanie nakładania (`src/lib/overlapDetector.ts`)

Nakładanie = niepuste przecięcie bounding boxów `weld-joint` i elementu (z uwzględnieniem rotacji przez transformację punktów).

### Zachowanie przy zaznaczeniu (LOCKED / SEQUENCE)

- Kliknięcie → zaznaczany fizycznie kliknięty kształt; otwierany odpowiedni panel właściwości.
- Drag na elemencie wewnątrz WeldUnit → przesuwa cały unit.
- Edycja parametrów zablokowanego elementu: niedostępna; wymaga odblokowania.
- Uchwyt obrotu: pojawia się na poziomie całego unitu; obraca cały unit.
- Marquee obejmujące WeldUnit → zaznacza unit jako całość.
- Multi-select wielu unitów → drag przesuwa wszystkie.

### Generowanie sekwencji (`src/weld-units/bead-sequence.ts`)

1. Z geometrii `weld-joint` obliczana liczba warstw i ściegów per warstwa.
2. Ściegi równomiernie rozmieszczone w warstwie.
3. Numeracja: 1, 2, 3… od dołu do góry, od lewej do prawej.
4. Użytkownik może ręcznie zmieniać numery w `WeldSequencePanel`.

Operacje (wszystkie cofalne przez Undo):
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

  addShape: (shape: Shape) => void          // sprawdza limit planu
  removeShape: (id: string) => void
  updateShapeTransient: (id: string, patch: ShapeUpdate) => void
  commitShapeUpdate: (id: string, before: ShapeUpdate, after: ShapeUpdate) => void
  reorderShape: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void
  mirrorShape: (id: string, axis: 'horizontal' | 'vertical') => void
}
```

### WeldUnitsSlice

```typescript
interface WeldUnitsSlice {
  weldUnits: WeldUnit[]

  lockUnit: (weldJointId: string, elementIds: string[]) => void
  unlockUnit: (unitId: string) => void
  convertToSequence: (unitId: string) => void
  addBeadToLayer: (unitId: string, layerIndex: number) => void
  removeBeadFromLayer: (unitId: string, layerIndex: number) => void
  addLayer: (unitId: string) => void
  removeLayer: (unitId: string, layerIndex: number) => void
  setBeadShape: (unitId: string, shape: BeadShape) => void
  setBeadNumber: (unitId: string, layerIndex: number, beadIndex: number, n: number) => void
  removeUnit: (unitId: string) => void
}
```

### HistorySlice

```typescript
interface HistoryEntry {
  shapeId: string
  before: ShapeUpdate
  after: ShapeUpdate
}

interface HistorySlice {
  history: HistoryEntry[]
  historyIndex: number

  pushHistory: (entry: HistoryEntry) => void
  undo: () => void
  redo: () => void
}
```

Max 100 wpisów. Nie persystowana do Supabase między sesjami.  
Operacje multi-shape → wiele wpisów (jeden per kształt).

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
  isDarkMode: boolean
  locale: 'pl' | 'en'

  setSelection: (ids: string[]) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  toggleSnap: () => void
  setSnapTemporary: (enabled: boolean) => void
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

SNAP przyciąga do **środków ścianek elementów**. Punkty obliczane przez `anchors()` z `SHAPE_REGISTRY` dla każdego kształtu na scenie (z pominięciem przeciąganego elementu i jego grupy).

Próg: `SNAP_THRESHOLD = 8 px` (przestrzeń canvasu).

**Sterowanie:**
- Toggle button w toolbarze (podświetlony = aktywny)
- Przytrzymanie `Alt`: tymczasowe wyłączenie; przycisk zmienia stan synchronicznie; zwolnienie przywraca poprzedni stan

`AnchorPoints.tsx` renderuje punkty SNAP jako małe diamenty gdy aktywny tryb `weld-joint`.

---

## 11. Historia operacji (Undo/Redo)

- `updateShapeTransient` — live drag, **bez historii**
- `commitShapeUpdate` — zapis do `history[]`
- Po każdym `commitShapeUpdate`: synchroniczny zapis pełnej sceny + historii do `localStorage`
- Max 100 wpisów; historia NIE trafia do Supabase

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

1. `src/shapes/profile-u/` — `types.ts`, `handles.ts`, `anchors.ts`, `index.ts`, `PropertiesPanel.tsx`
2. `src/shapes/index.ts` — `'profile-u'` do unii `ShapeType`
3. `src/shapes/registry.ts` — `'profile-u': ProfileUDefinition`
4. `src/store/types.ts` — `Omit<ProfileUShape, 'id' | 'type'>` do `AllShapeGeometry`

Żaden inny plik nie ulega modyfikacji — `ShapeHandles`, `PropertiesSidebar`, `snapEngine`, `documentCodec`, `exportEngine` działają automatycznie.

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
        ├── anchors?(s)              → AnchorPoint[]
        └── validate?(s)             → ValidationError[]

Store (Zustand + Immer)
  ├── shapes: Shape[]           z-index = kolejność tablicy
  ├── weldUnits: WeldUnit[]
  ├── history: HistoryEntry[]   max 100, localStorage only
  ├── canvas                    viewport, zoom, toolMode
  ├── ui                        selection, snap, darkMode
  └── document                  name, isDirty, save state

WeldUnit
  FREE → LOCKED → SEQUENCE
       ←        ←
  lock: bbox overlap ≥ 2 elementy
  unlock: sequence → dormant (przywrócenie przy ponownym lock jeśli checksum OK)

Canvas (Konva)
  Layer 1: shapes + WeldUnit overlays   [z-index = kolejność shapes[]]
  Layer 2: handles, WeldUnitHandles, marquee, anchors   [zawsze na wierzchu]

Persistence
  localStorage : scena + historia → odtwarzanie przy starcie
  Supabase     : JSONB snapshot przy świadomym zapisie, bez historii

Nowy kształt → 4 miejsca:
  src/shapes/[typ]/      nowy katalog
  src/shapes/index.ts    +1 do ShapeType
  src/shapes/registry.ts +1 do SHAPE_REGISTRY
  src/store/types.ts     +1 do AllShapeGeometry
```
