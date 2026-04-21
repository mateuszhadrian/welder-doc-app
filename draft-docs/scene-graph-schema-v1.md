# Model danych sceny (Scene Graph) — schemat JSON v1.0

**Projekt:** Aplikacja do projektowania złączy spawanych  
**Data:** 2026-04-21  
**Status:** Zaakceptowany — gotowy do implementacji  
**Powiązane:** ADR-001 (silnik Paper.js), PRD (nierozwiązane kwestie #1 i #2 — zamknięte)

---

## Kontekst i decyzje wejściowe

Schemat powstał na podstawie sesji planowania PRD. Poniższe decyzje bezpośrednio kształtują strukturę modelu:

| Decyzja | Wartość |
|---|---|
| Układ współrzędnych | Absolutne współrzędne canvasu dla każdego węzła |
| Ukosowanie | Właściwość (`bevel`) wewnątrz prymitywu, max jedna krawędź |
| Ściegi | Niezależne węzły na scenie (nie przypisane do elementów) |
| Model grupy | Płaski — węzeł grupy przechowuje `childIds[]` |
| Viewport przy otwarciu | Reset do fit-to-content (viewport nie jest zapisywany w dokumencie) |
| Historia Undo/Redo | Tylko w pamięci — nie serializowana do JSON / Supabase |
| Limit planu | Dotyczy **wyłącznie prymitywów** (`plate`, `pipe`, `profile`) |

---

## Typy bazowe

```typescript
type NodeId = string; // UUID v4

type NodeType = "plate" | "pipe" | "profile" | "weld" | "group";

interface Vec2 {
  x: number;
  y: number;
}
```

---

## Ukosowanie (Bevel)

Ukosowanie jest **opcjonalną właściwością prymitywu** — nie osobnym węzłem w scenie.  
Jeden element może mieć ukosowanie tylko na **jednej krawędzi** jednocześnie.

```typescript
type BevelEdge = "top" | "bottom" | "left" | "right";
type BevelType = "none" | "V" | "Y" | "X" | "K";

interface Bevel {
  edge: BevelEdge;
  type: BevelType;
  /** Kąt główny (lub górny dla X/K), w stopniach */
  angle: number;
  /** Kąt dolny — tylko dla typów X i K */
  angleSecondary?: number;
}
```

---

## Węzeł bazowy

Każdy węzeł w scenie dziedziczy pola `BaseNode`.

```typescript
interface BaseNode {
  id: NodeId;
  type: NodeType;
  /** Pozycja środka elementu w absolutnych współrzędnych canvasu */
  position: Vec2;
  /** Obrót w stopniach (zgodnie z ruchem wskazówek zegara) */
  rotation: number;
  /** null = węzeł na poziomie głównym sceny */
  parentGroupId: NodeId | null;
  locked: boolean;
  visible: boolean;
}
```

---

## Prymitywy

> ⚠️ **Tylko węzły `PrimitiveNode` wliczają się do limitu planu** (Guest: 5, Free: 15, Pro: ∞).

### Płyta prostokątna (`PlateNode`)

```typescript
interface PlateNode extends BaseNode {
  type: "plate";
  params: {
    width: number;      // mm
    thickness: number;  // mm
  };
  bevel: Bevel | null;
}
```

### Rura (`PipeNode`)

```typescript
interface PipeNode extends BaseNode {
  type: "pipe";
  params: {
    outerDiameter: number;  // mm
    wallThickness: number;  // mm
  };
  bevel: Bevel | null;
}
```

### Profil (`ProfileNode`)

```typescript
type ProfileShape = "L" | "C" | "I";

interface ProfileNode extends BaseNode {
  type: "profile";
  params: {
    shape: ProfileShape;
    height: number;          // mm
    width: number;           // mm
    flangeThickness: number; // mm
    webThickness: number;    // mm
  };
  bevel: Bevel | null;
}
```

### Unia prymitywów

```typescript
type PrimitiveNode = PlateNode | PipeNode | ProfileNode;
```

---

## Ścieg spawania (`WeldNode`)

Ściegi są **niezależnymi obiektami na canvasie** — nie są przypisane do konkretnych elementów ani krawędzi.  
Usunięcie prymitywu **nie usuwa** powiązanych ściegów.  
Węzły `WeldNode` **nie wliczają się** do limitu planu.

```typescript
type WeldShape = "ellipse" | "circle";
type LabelMode = "manual" | "auto";

interface WeldNode extends BaseNode {
  type: "weld";
  shape: WeldShape;
  /** Skala niezależna od prymitywów — ściegi skalowane transformem, nie params */
  scale: Vec2;
  sequenceOrder: number | null;
  label: string | null;
  labelMode: LabelMode;
}
```

---

## Grupa (`GroupNode`)

Grupa to **niepodzielny obiekt** — bez in-group edit w MVP.  
Węzeł grupy przechowuje płaską listę identyfikatorów dzieci (`childIds`).  
Elementy-dzieci nadal istnieją jako osobne wpisy w tablicy `nodes` (z ustawionym `parentGroupId`).  
Węzły `GroupNode` **nie wliczają się** do limitu planu.

> ℹ️ W MVP grupy mogą zawierać tylko prymitywy — zagnieżdżanie grup jest poza zakresem MVP.

```typescript
interface GroupNode extends BaseNode {
  type: "group";
  childIds: NodeId[];
  scale: Vec2;
}
```

---

## Unia wszystkich węzłów sceny

```typescript
type NonCountedNode = WeldNode | GroupNode;

type SceneNode = PrimitiveNode | NonCountedNode;
```

---

## Metadane projektu

```typescript
interface ProjectMeta {
  id: string;        // UUID projektu (klucz w Supabase)
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /**
   * Przyszłe link-sharing — pole obecne w schemacie od MVP,
   * wartość null dopóki funkcja nie zostanie zaimplementowana.
   */
  shareToken: string | null;
  /** null = projekt gościa przechowywany w localStorage */
  ownerId: string | null;
}
```

---

## Ustawienia sceny

```typescript
type UnitSystem = "mm" | "inch" | "custom";

interface SceneSettings {
  unitSystem: UnitSystem;
  snapEnabled: boolean;
  darkMode: boolean;
  language: "pl" | "en";
}
```

---

## Dokument główny (root JSON)

```typescript
interface SceneDocument {
  /**
   * Wersja schematu — obowiązkowa przy implementacji migracji.
   * Przy każdej zmianie niekompatybilnej wstecz: bump wersji.
   */
  schemaVersion: "1.0";
  meta: ProjectMeta;
  settings: SceneSettings;
  /**
   * Płaska lista wszystkich węzłów sceny.
   *
   * LIMIT PLANU (5 / 15 / ∞) dotyczy wyłącznie węzłów typu:
   * "plate" | "pipe" | "profile"
   *
   * Węzły "weld" i "group" są poza limitem.
   */
  nodes: SceneNode[];
}
```

---

## Limity planów i feature-gate logic

### Tabela limitów

| Plan | Prymitywy na scenie | Projekty w chmurze | Watermark |
|---|---|---|---|
| Guest | max **5** | 0 (localStorage) | ✅ |
| Free | max **15** | 3 | ✅ |
| Pro | bez limitu | bez limitu | ❌ |

> Limit dotyczy wyłącznie węzłów `PrimitiveNode`. Ściegi (`weld`) i grupy (`group`) nie są wliczane.

### Implementacja

```typescript
const PRIMITIVE_TYPES = new Set<NodeType>(["plate", "pipe", "profile"]);

const PLAN_LIMITS = {
  guest: 5,
  free: 15,
  pro: Infinity,
} as const;

type Plan = keyof typeof PLAN_LIMITS;

function countPrimitives(nodes: SceneNode[]): number {
  return nodes.filter(n => PRIMITIVE_TYPES.has(n.type)).length;
}

function canAddPrimitive(nodes: SceneNode[], plan: Plan): boolean {
  return countPrimitives(nodes) < PLAN_LIMITS[plan];
}
```

Użycie przed każdą operacją dodania prymitywu:

```typescript
if (!canAddPrimitive(scene.nodes, userPlan)) {
  // pokaż toast z komunikatem o limicie i CTA do upgrade
  return;
}
```

---

## Przykładowy dokument JSON

Złącze: płyta prostokątna + rura + jeden ścieg spawania.

```json
{
  "schemaVersion": "1.0",
  "meta": {
    "id": "c3f1a2b4-0000-0000-0000-000000000001",
    "name": "Złącze T — projekt testowy",
    "createdAt": "2026-04-21T10:00:00Z",
    "updatedAt": "2026-04-21T11:30:00Z",
    "shareToken": null,
    "ownerId": "user-uuid-0000-0000-000000000001"
  },
  "settings": {
    "unitSystem": "mm",
    "snapEnabled": true,
    "darkMode": false,
    "language": "pl"
  },
  "nodes": [
    {
      "id": "plate-001",
      "type": "plate",
      "position": { "x": 0, "y": 0 },
      "rotation": 0,
      "parentGroupId": null,
      "locked": false,
      "visible": true,
      "params": {
        "width": 200,
        "thickness": 12
      },
      "bevel": {
        "edge": "top",
        "type": "V",
        "angle": 45
      }
    },
    {
      "id": "pipe-001",
      "type": "pipe",
      "position": { "x": 0, "y": -80 },
      "rotation": 90,
      "parentGroupId": null,
      "locked": false,
      "visible": true,
      "params": {
        "outerDiameter": 60,
        "wallThickness": 5
      },
      "bevel": null
    },
    {
      "id": "weld-001",
      "type": "weld",
      "shape": "ellipse",
      "position": { "x": 0, "y": -6 },
      "rotation": 0,
      "scale": { "x": 1.2, "y": 0.8 },
      "parentGroupId": null,
      "locked": false,
      "visible": true,
      "sequenceOrder": 1,
      "label": "1",
      "labelMode": "auto"
    }
  ]
}
```

---

## Decyzje projektowe (ADR inline)

| Kwestia | Decyzja | Uzasadnienie |
|---|---|---|
| `schemaVersion` jako string | `"1.0"`, nie liczba | Ułatwia migracje semver w przyszłości (`"1.1"`, `"2.0"`) |
| Historia Undo/Redo poza JSON | Tylko pamięć, nie Supabase | Brak sensu serializowania 20 kroków do bazy danych |
| `scale` tylko na `WeldNode` i `GroupNode` | Prymitywy skalowane przez `params`, nie transform | Unika desync między wyświetloną wartością a przechowywaną |
| `shareToken: null` w MVP | Pole obecne w schemacie od startu | Zero zmian schematu bazy przy wdrożeniu link-sharingu |
| `viewport` poza dokumentem | Fit-to-content przy każdym otwarciu | Decyzja z sesji planowania — prostsze UX, brak edge-casów |
| Limit planu | Tylko `PrimitiveNode` (`plate`, `pipe`, `profile`) | Ściegi i grupy nie tworzą nowej geometrii złącza |
| Grupy — model płaski | `childIds[]` w węźle grupy | Prostsze zapytania, łatwiejszy Undo/Redo |
| Ukosowanie — właściwość prymitywu | `bevel: Bevel \| null` wewnątrz węzła | Jedna krawędź per element — nie wymaga osobnego węzła |

---

## Otwarte kwestie (poza zakresem tego dokumentu)

Poniższe punkty z oryginalnej listy "Nierozwiązane kwestie" pozostają otwarte i wymagają osobnych decyzji przed lub w trakcie implementacji:

- **Model subskrypcji i płatności** — nie wybrany dostawca (np. Stripe); konieczne przed implementacją planu Pro.
- **Szczegółowy zakres walidacji geometrycznej** — zakresy kątów ukosowania, min/max grubości, kolizje elementów.
- **GDPR compliance** — polityka prywatności, cookie consent, regulamin; wymagane przed publicznym launchem.
- **Strategia cenowa planu Pro** — cena miesięczna/roczna; niezbędna przed landing page i systemem płatności.
- **Design UI/UX** — brak makiet; tworzony przed fazą frontendu, punkt wyjścia: weldia.app.
