# Endpoint
GET /api/health

## Description
Sprawdzenie stanu serwisu (dla CI, monitoringu, Vercel deploy checks). Custom Route Handler — plik `src/app/api/health/route.ts`.

## Authentication / Authorization
- **Brak** — endpoint publiczny.

## Request
- **Parametry zapytania:** brak.
- **Body:** brak.
- **Headers:** brak.

## Response

### 200 OK
```json
{
  "status": "ok",
  "timestamp": "2026-05-08T12:00:00Z"
}
```

### 503 Service Unavailable (problem z DB)
```json
{
  "status": "degraded",
  "timestamp": "2026-05-08T12:00:00Z",
  "checks": {
    "database": "unreachable"
  }
}
```

## Error Codes
| Kod | Body | Powód |
|---|---|---|
| 503 | `{ "status": "degraded", ..., "checks": { "database": "unreachable" } }` | Brak komunikacji z Supabase |

## Database Tables Involved
- Brak (lub opcjonalny lekki probe — `select 1` przez admin client w `_health` schemacie). W MVP: brak DB call lub szybki `auth.getUser()` jako liveness probe.

## Business Logic
1. Zwróć `{ status: 'ok', timestamp: now() }` jeśli liveness probe nie wymaga DB.
2. Opcjonalnie: lekki probe DB (np. `select 1`) z timeoutem 2-3s. Niepowodzenie → 503 z `checks.database = 'unreachable'`.

## Validation Rules
- Brak.

## Rate Limiting
- TODO: 60 / min / IP (DDoS guard) — publiczny endpoint, ryzyko abuse jako keep-alive ping.

## Environment Variables
- (Opcjonalnie dla DB probe) `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Implementation Notes
- Plik: `src/app/api/health/route.ts` (już zaimplementowany).
- Używany przez Vercel deploy checks i ewentualne external monitory (UptimeRobot itp.).
- Trzymać szybko (<100ms p95).
