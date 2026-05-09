# Verification Report: DELETE /api/user/account

## Overall Status

PASSED WITH WARNINGS

## 1. Consistency with api-plan.md

### Issues Found

No issues found.

### Warnings

- Plan §6 wymienia limit `3 / godzinę / IP, 1 / dobę / user` z api-plan.md §6.2 jako TODO post-MVP — zgodne z planem (M1 odroczone). Warto jednak doprecyzować w sekcji "Post-MVP TODO", że pierwsza linia obrony (Supabase Auth `sign_in_sign_ups = 30 / 5 min / IP`) liczy IP, nie usera, więc współdzielony NAT może być fałszywie ograniczony — to jest świadomy trade-off, ale obecnie nieadresowany w żadnym miejscu planu.
- Implementation plan poprawnie wskazuje, że subscriptions zostaną z `user_id = NULL` + `paddle_customer_snapshot`. api-plan §2.1 mówi "anonimizowane przez SET NULL" — plan implementacyjny jest spójny, ale formuła "zachowane dla audytu" mogłaby przywołać explicite §16 architecture-base, żeby reviewer od razu wiedział, że to nie defekt.

## 2. Consistency with prd.md

### Issues Found

No issues found.

### Warnings

- PRD nie ma dedykowanego user-story `US-###` dla usunięcia konta — wymóg figuruje wyłącznie w §3.10 (l. 226) + §4 W zakresie MVP (l. 250). Plan pokrywa pełen zakres tej linii (re-auth hasłem, kaskada na projekty/zgody/profil, SET NULL na subscriptions). Brak kryteriów akceptacji w PRD oznacza, że E2E spec opisany w kroku §9.12 (redirect na `/[locale]/account-deleted`, sesja wyczyszczona) nie ma sformalizowanej weryfikacji w PRD — to luka PRD, nie planu, ale warto ją zaadresować przy najbliższej rewizji.

## 3. Internal Consistency

### Issues Found

- **Sprzeczność §7 ↔ §9 krok 5 w mapowaniu błędów `signInWithPassword`.** Tabela §7 (wiersz 7) jasno mapuje "`signInWithPassword()` zwróciło inny error" → `500 internal_error`. Natomiast §9 krok 5 mówi: *"`signInErr` (jakikolwiek inny — Supabase zwraca `Invalid login credentials` przy złym haśle) → `return err('invalid_password', 401)`. **Nie rozdzielać** "user not found" od "wrong password""*. Te dwa zdania są niespójne — pierwsze degraduje wszystkie nieoznaczone błędy do 401, drugie eskaluje je do 500. Implementator musi otrzymać jednoznaczną regułę: "rate-limit → 429, jawne `invalid_credentials`/`Invalid login credentials` → 401, wszystko inne (np. Supabase Auth down, network error) → 500". Zostawienie tej sprzeczności pozwoli przepuścić błędy infrastrukturalne jako `invalid_password` i wprowadzi w błąd zarówno usera, jak i obserwowalność.

### Warnings

- §3 zakłada, że `DeleteAccountCommand`, `DeleteAccountResponseDto`, `DeleteAccountApiErrorCode`, `TypedApiErrorDto` są już zdefiniowane w `src/types/api.ts`. Plan nie weryfikuje tej zależności w kroku implementacyjnym — jeśli któryś z tych typów nie istnieje, krok 2 kompilacji `pnpm typecheck` (krok §9.15) zawiedzie po fakcie. Warto dodać krok §9.0: "Zweryfikuj, że `src/types/api.ts` eksportuje wszystkie cztery wymienione typy; jeśli nie — uzupełnij przed implementacją handlera".
- §7 + §9.5 dopuszczają tymczasowe `if (err.message?.includes('Invalid login'))` z komentarzem TODO, jednocześnie odsyłając do `mapAuthError()` w `src/lib/supabase/errors.ts` (jeszcze nie istnieje — CLAUDE.md "Not yet implemented"). CLAUDE.md explicit zabrania `error?.message.includes('...')` jako anti-pattern. Plan świadomie wprowadza ten anti-pattern jako tymczasowy — wymagane jest, by w komentarzu TODO znalazł się odnośnik do issue/zadania na zamianę po dostarczeniu `errors.ts`, inaczej zostanie zapomniany. Sugerowane: explicite zaznaczyć w §16 (Post-MVP TODO) "Replace inline `includes('Invalid login')` z `mapAuthError()` po wdrożeniu `src/lib/supabase/errors.ts`".
- §9.7 (`signOut()` po `deleteUser`) — plan poprawnie zaznacza, że error z `signOut()` po skasowaniu usera może wystąpić i jest OK. Warto doprecyzować, że nawet jeśli `signOut()` rzuci, response 200 z `Set-Cookie: sb-* Max-Age=0` MUSI nadal zostać wysłany — w przeciwnym razie cookies klienta nie zostaną wyczyszczone i wszystkie kolejne requesty zwrócą 401, ale bez UI-side cleanup. Krok §9.9 (zewnętrzny try/catch) mógłby tu przypadkowo zwrócić 500 zamiast 200, jeśli `signOut()` zostanie wywołany przed `NextResponse.json(body)` i rzuci. Zalecane: w §9.7 owinąć `signOut()` w `try/catch` z silentem, nie polegać na zewnętrznym wrapperze §9.9.
- §9.10 nakazuje aktualizację `scripts/verify-routes.sh`. CLAUDE.md potwierdza, że `pnpm verify:routes` istnieje, ale plan nie pokazuje, czy aktualnie ten skrypt jest deklaratywny (lista paths) czy procedury manualnej. Wymaga jednoliniowego sprawdzenia bash przed implementacją (`grep -n 'user/account' scripts/verify-routes.sh`).

## 4. Summary

Plan implementacyjny jest dojrzały, kompletnie pokrywa wymagania `api-plan.md §2.1` oraz §3.10/§4 PRD, a sekwencja kroków (createClient → getUser → walidacja body → temp-client signInWithPassword → admin.deleteUser → signOut) jest poprawna i zgodna z architekturą trzech klientów Supabase. Jedyny krytyczny problem to wewnętrzna sprzeczność między tabelą §7 a krokiem §9.5 w mapowaniu nieoznaczonych błędów `signInWithPassword` — wymaga jednoznacznego doprecyzowania (zalecane: rate-limit → 429, explicite invalid credentials → 401, pozostałe → 500). Po jego rozwiązaniu i uwzględnieniu warningów (weryfikacja istnienia typów w `src/types/api.ts`, izolowany try/catch wokół `signOut()`, ślad post-MVP na zamianę inline `includes` na `mapAuthError`) plan jest gotowy do przekazania zespołowi developerskiemu.
