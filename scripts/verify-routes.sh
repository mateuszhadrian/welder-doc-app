#!/usr/bin/env bash
# CI gate: weryfikuje, że Route Handlery wymagane przez kontrakt
# (`api-plan.md` §2.1, `vercel.json crons[]`, presence of payment / consent
# code paths) faktycznie istnieją w `src/app/api/`.
#
# Uzupełnia ręczną PR checklistę z `CLAUDE.md` o automatyczną bramkę merge.
# Wywoływane jako `pnpm verify:routes` w CI.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

errors=0

check_file() {
  local relpath="$1"
  local reason="$2"
  if [[ ! -f "$relpath" ]]; then
    echo "MISSING: $relpath — $reason"
    errors=$((errors + 1))
  fi
}

# 1. Crony: każda ścieżka z vercel.json musi mieć route.ts.
node -e '
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const missing = (cfg.crons || []).filter(
  (c) => !fs.existsSync(`./src/app${c.path}/route.ts`)
);
if (missing.length) {
  for (const c of missing) {
    console.log(`MISSING: src/app${c.path}/route.ts — vercel.json crons[] declares ${c.schedule}`);
  }
  process.exit(1);
}
' || errors=$((errors + 1))

# 2. Paddle webhook: jeśli @paddle/paddle-js w deps → route.ts musi istnieć.
node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const usesPaddle = !!(pkg.dependencies && pkg.dependencies["@paddle/paddle-js"]);
if (usesPaddle && !fs.existsSync("./src/app/api/paddle/webhook/route.ts")) {
  console.log("MISSING: src/app/api/paddle/webhook/route.ts — @paddle/paddle-js in dependencies");
  process.exit(1);
}
' || errors=$((errors + 1))

# 3. Consent + user/export — wymagane pre-deploy do prod (RODO art. 7 + art. 20).
check_file "src/app/api/consent/route.ts" "RODO art. 7 (consent log)"
check_file "src/app/api/user/export/route.ts" "RODO art. 20 (data portability)"

# 4. Health endpoint — wymagany dla monitoringu / deploy checks.
check_file "src/app/api/health/route.ts" "monitoring / Vercel deploy check"

if [[ $errors -gt 0 ]]; then
  echo ""
  echo "verify:routes failed — $errors missing route handler(s)."
  exit 1
fi

echo "verify:routes OK"
