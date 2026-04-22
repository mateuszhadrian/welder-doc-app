# Rekomendacje do otwartych kwestii PRD
### Aplikacja do projektowania złączy spawanych
**Data:** 2026-04-22 | **Wersja:** 1.0 | **Status:** Do weryfikacji

---

## Kontekst zebrany podczas sesji

| Parametr | Ustalenie |
|---|---|
| Model finansowania | Bootstrapped, brak zewnętrznego finansowania |
| Forma prawna | JDG (docelowo spółka z partnerem branżowym) |
| Status VAT | VAT-owiec, posiada NIP |
| Rynek docelowy | Polska (start), EU (cel długoterminowy) |
| Waluta | PLN (priorytet), EUR (przyszłość) |
| Docelowi użytkownicy | Technolodzy/inżynierowie w małych warsztatach spawalniczych |
| Decyzja zakupowa | Indywidualna (nie wymaga akceptacji zarządu/księgowości) |
| Model subskrypcji | Per-seat (1 subskrypcja = 1 użytkownik) |
| Podejście do compliance | Ship fast, fix later |
| Dostęp do prawnika | Brak (do ustalenia) |
| Dostęp do beta-testerów | Tak (przez partnera branżowego) |
| Szacowany czas do launchu | ~3 miesiące |
| Analytics | Cookie consent wymagany (planowane pełne analytics) |

---

<analysis>

## Analiza kluczowych kwestii

### Syntetyczne wnioski

Profil projektu to klasyczny **bootstrapped B2B SaaS z niską złożonością transakcyjną** na starcie:
niskie wolumeny użytkowników, jeden rynek, jeden segment klientów, jeden plan płatny, waluta PLN.
To bardzo korzystna sytuacja — pozwala na wybór najprostszych, najszybszych rozwiązań bez konieczności
budowania skomplikowanej infrastruktury.

Kluczowe napięcie, które wyłoniło się z sesji: **ambicja 3-miesięcznego launchu** zderzająca się
z **czterema nierozwiązanymi kwestiami**, z których każda mogłaby osobno zająć kilka tygodni.
Dlatego rekomendacje poniżej są skalibrowane pod "ship fast" — minimalizujemy złożoność,
maksymalizujemy szybkość dotarcia do pierwszego płacącego klienta.

### Powiązania między kwestiami

Wybór dostawcy płatności determinuje wszystkie pozostałe kwestie:
- **Dostawca jako Merchant of Record** → rozwiązuje VAT compliance i fakturowanie automatycznie → upraszcza GDPR (mniej danych własnych do przetwarzania) → narzuca dostępne metody płatności.
- **Strategia cenowa** zależy od prowizji dostawcy (MoR pobiera 5–10% vs. Stripe ~1.4%+0.25€) — cena końcowa musi absorbować ten koszt.
- **GDPR** jest najprostszy, gdy przetwarzamy minimum danych — a MoR przejmuje dane rozliczeniowe.

### Ryzyko "ship fast, fix later" w kontekście GDPR

GDPR to obszar, gdzie "fix later" ma **twardą granicę prawną**: brak polityki prywatności
i regulaminu przy publicznym dostępie do aplikacji zbierającej e-maile jest naruszeniem przepisów
od dnia pierwszej rejestracji użytkownika. Przy podejściu bootstrapped ryzyko jest niskie
(nikt nie będzie zgłaszał skargi do UODO w pierwszym tygodniu), ale jest to ryzyko świadome.
Rekomendacja: zminimalizować je przez użycie generatorów + review przez ChatGPT/prawnika online
przed launchem — koszt to kilka godzin, nie tygodni.

</analysis>

---

<recommendations>

## Rekomendacje

---

### 1. Model subskrypcji i płatności

#### ✅ Rekomendacja: Paddle jako Merchant of Record

**Uzasadnienie:**
Paddle działa jako Merchant of Record — formalnie to Paddle sprzedaje produkt klientowi końcowemu,
a Ty otrzymujesz wypłatę po potrąceniu prowizji. Konsekwencje:
- Paddle wystawia faktury VAT klientom (zwalnia Cię z obowiązku wystawiania faktur za subskrypcje).
- Paddle obsługuje VAT EU, VAT PL — zero pracy z Twojej strony.
- Obsługuje BLIK, karty, przelewy lokalne — gotowe dla polskiego rynku.
- Integracja z Next.js jest dobrze udokumentowana.

**Alternatywa: LemonSqueezy** — identyczny model MoR, nieco prostszy onboarding, ale mniejszy
niż Paddle i historycznie mniej stabilny. Jako backup, nie jako pierwsza opcja.

**Dlaczego nie Stripe:**
Stripe ma niższe prowizje (~1.4% + 0.25€ vs Paddle ~5%), ale wymaga samodzielnej obsługi VAT EU
(lub zakupu Stripe Tax), generowania faktur i rejestracji VAT w krajach klientów. Dla bootstrapped
solo-developera z launchem za 3 miesiące — zbyt duże obciążenie operacyjne na starcie.

**Prowizja Paddle:** ~5% + $0.50 per transakcja. Przy cenie 50 PLN/mies. to ok. 3 PLN prowizji —
akceptowalne na wczesnym etapie. Można renegocjować po osiągnięciu wolumenu.

#### Kroki implementacji

1. Zarejestruj konto na [paddle.com](https://paddle.com) (wymagane: NIP, dane JDG, konto bankowe).
2. Skonfiguruj produkt "Pro Monthly" i "Pro Annual" w dashboardzie Paddle.
3. Zainstaluj `@paddle/paddle-js` w projekcie Next.js.
4. Zaimplementuj webhook do aktualizacji statusu subskrypcji w Supabase
   (tabela `subscriptions` z polami: `paddle_subscription_id`, `status`, `plan`, `current_period_end`).
5. Skonfiguruj checkout overlay (Paddle Billing) — nie wymaga własnej strony płatności.

#### Timeline

Tydzień 8–10 (przed launchem): integracja płatności powinna być gotowa na 2–3 tygodnie przed launchem,
żeby przetestować pełny flow z prawdziwą kartą.

#### Zależności

- Decyzja o cenie (patrz punkt 4) musi być podjęta przed konfiguracją produktów w Paddle.
- Schemat bazy danych Supabase musi zawierać tabelę `subscriptions`.

---

### 2. Szczegółowy zakres walidacji geometrycznej

#### ✅ Rekomendacja: Minimal viable validation — 3 poziomy, zdefiniowane reguły

**Zasada generalna:** Walidacja w MVP powinna chronić przed crashem aplikacji i oczywistymi
błędami użytkownika — nie musi być technicznie zgodna z normami ISO 2553/AWS (to poza MVP).

#### Propozycja reguł walidacji dla MVP

**Poziom 1 — Walidacja pól (inline, czerwona ramka + komunikat):**

| Parametr | Min | Max | Krok | Komunikat błędu |
|---|---|---|---|---|
| Grubość płyty | 1 mm | 200 mm | 0.1 mm | „Grubość musi być między 1 a 200 mm" |
| Szerokość płyty | 5 mm | 2000 mm | 0.1 mm | „Szerokość musi być między 5 a 2000 mm" |
| Średnica rury (zew.) | 5 mm | 500 mm | 0.1 mm | „Średnica musi być między 5 a 500 mm" |
| Grubość ścianki rury | 1 mm | 50 mm | 0.1 mm | „Grubość ścianki musi być między 1 a 50 mm" |
| Grubość ścianki rury | — | `(OD/2) - 1` | — | „Grubość ścianki nie może przekraczać promienia rury" |
| Kąt ukosowania | 0° | 80° | 0.5° | „Kąt ukosowania musi być między 0° a 80°" |
| Obrót elementu | 0° | 360° | 0.1° | — (normalizacja, bez błędu) |

**Poziom 2 — Walidacja przy dodawaniu elementu (toast notification):**
- Przekroczenie limitu elementów dla planu (Guest: 5, Free: 15) → toast z CTA do upgrade.
- Próba dodania elementu o wymiarach zerowych → blokada + inline error.

**Poziom 3 — Walidacja przy eksporcie (toast notification):**
- Pusta scena (0 elementów) → toast „Dodaj przynajmniej jeden element przed eksportem".
- Błąd zapisu w Supabase → toast „Nie udało się zapisać projektu. Spróbuj ponownie."

**Czego NIE walidujemy w MVP:**
- Kolizji geometrycznych między elementami (elementy mogą się nakładać — to zamierzone).
- Zgodności z normami spawalniczymi (zakres kątów dopuszczalnych normami, itp.).
- Sensowności sekwencji spawania.

#### Kroki implementacji

1. Zdefiniuj stałe w pliku `src/constants/validation.ts` (MIN_PLATE_THICKNESS, MAX_PLATE_WIDTH, itp.).
2. Zbuduj funkcje walidacyjne w `src/lib/validation/` — pure functions, łatwe do testowania Vitestem.
3. Podepnij do komponentów formularzy jako custom hook `useParameterValidation`.
4. Toast notifications przez shadcn/ui `<Toast>` — już w stacku.

#### Timeline

Tydzień 4–6: razem z budową komponentów parametrycznych. Walidacja to część każdego komponentu
prymitywu, nie osobny sprint.

---

### 3. GDPR compliance i kwestie prawne

#### ✅ Rekomendacja: Minimum viable compliance przed launchem, rozbudowa po

Przy podejściu "ship fast" i JDG jako administratorze danych — poniżej absolutne minimum
wymagane przed pierwszą publiczną rejestracją użytkownika.

#### Obowiązkowe przed launchem (nie można pominąć)

**A. Polityka Prywatności**
- Użyj generatora: [iubenda.com](https://www.iubenda.com) (plan Free obsługuje podstawowe PL/EU cases)
  lub [privacypolicygenerator.info](https://www.privacypolicygenerator.info).
- Musi zawierać: kto jest administratorem (Twoje dane JDG + NIP), jakie dane zbierasz (email,
  dane rozliczeniowe), kto jest procesorem danych (Supabase EU, Paddle, dostawca emaili).
- **Czas:** 2–4 godziny z generatorem + weryfikacja przez ChatGPT pod kątem polskiego prawa.

**B. Regulamin (Terms of Service)**
- Musi zawierać: opis usługi, plany i limity, politykę zwrotów (standardowo: 14 dni dla konsumentów
  EU, ale Twoi klienci to przedsiębiorcy — warto to zaznaczyć), klauzulę o wyłączeniu odpowiedzialności.
- Generator: [termsofservicegenerator.net](https://www.termsofservicegenerator.net) lub Iubenda.
- **Czas:** 2–4 godziny.

**C. Cookie Consent Banner**
- Skoro planujesz pełne analytics (Google Analytics lub podobne) — banner jest wymagany.
- Rekomendacja: **CookieYes** (plan Free do 100 req/dzień wystarczy na start) lub
  **Cookiebot** (plan Free do 100 stron). Obie usługi generują gotowy skrypt do wklejenia w Next.js.
- Dla privacy-first analytics bez bannera: rozważ **Plausible** (EU-hosted, GDPR-compliant
  by design, brak cookie — nie wymaga zgody). Plausible + Google Analytics to możliwa kombinacja:
  Plausible bez bannera dla podstawowych statystyk, GA z bannerem dla głębszej analityki.
- **Czas:** 2–3 godziny konfiguracji.

**D. Checkbox zgody przy rejestracji**
- Pole: „Akceptuję Regulamin i Politykę Prywatności" (wymagane, niezaznaczone domyślnie).
- Zapis w bazie danych: pole `consent_accepted_at` (timestamp) i `consent_version` w tabeli `users`.
- **Czas:** 1–2 godziny developerskie.

#### Do ustalenia po launchem (nie blokuje MVP)

- Formalna umowa powierzenia danych (DPA) z Supabase — Supabase udostępnia gotowy DPA do podpisania.
- Dostawca emaili transakcyjnych (Resend / Postmark) — wybór i konfiguracja; do tego czasu można
  użyć Supabase Auth emaili jako tymczasowego rozwiązania.
- Konsultacja z prawnikiem przed przekształceniem JDG w spółkę — zmiana administratora danych wymaga
  aktualizacji polityki prywatności.
- Rozbudowana polityka cookies gdy wdrożysz pełne analytics.

#### Ryzyko świadome (akceptowalne przy bootstrapped starcie)

Przez pierwsze tygodnie/miesiące po launchem brak formalnej DPA z każdym procesorem danych
jest technicznym naruszeniem GDPR. Przy małej skali i braku incydentów — praktyczne ryzyko kary
od UODO jest minimalne. Ważne: **nie ignoruj tego bezterminowo** — wróć do tego tematu
przed pierwszym zewnętrznym marketingiem i zanim baza użytkowników przekroczy ~100 osób.

#### Timeline

Tydzień 10–11 (2 tygodnie przed launchem): wdrożenie cookie bannera, polityki, regulaminu,
checkboxa w formularzu rejestracji. Łącznie ~10–15 godzin roboczych.

---

### 4. Strategia cenowa planu Pro

#### ✅ Rekomendacja: Ceny startowe w PLN, z rocznym dyskontem, do weryfikacji po beta

> ⚠️ **Uwaga:** Poniższe kwoty to punkt startowy do dyskusji i testowania —
> nie finalna decyzja biznesowa. Wymagają walidacji z użytkownikami beta
> przed wdrożeniem na produkcję.

#### Proponowane ceny startowe

| Plan | Cena | Uwagi |
|---|---|---|
| Free | 0 PLN | Bez karty, bez limitu czasowego |
| Pro Monthly | **49 PLN / mies.** | ~11€ / ~12$ |
| Pro Annual | **399 PLN / rok** | ~33 PLN/mies., oszczędność ~32% vs monthly |

**Uzasadnienie kwot:**
- 49 PLN miesięcznie mieści się w "nie pytam szefa" — technolog może to kupić z własnej kieszeni
  tak jak kupuje subskrypcję Spotify czy narzędzie na smartfona.
- Próg psychologiczny "poniżej 50 PLN" jest istotny dla polskiego rynku B2SMB.
- 399 PLN rocznie (~33 PLN/mies.) daje wyraźną oszczędność (~32%) — standardowy poziom
  motywujący do wyboru rocznej subskrypcji.
- Przy prowizji Paddle (~5% + ~2 PLN stałe) marża jest zdrowa nawet przy tej cenie.

#### Mechanizmy konwersji (do decyzji przed launchem)

**Trial Pro:** Rekomendowane **14 dni free trial bez karty** (lub z kartą — do weryfikacji A/B).
Alternatywa: brak trialu, poleganie na planie Free jako "wiecznym darmowym" narzędziu.
Decyzja: wróć do tego po pierwszych rozmowach z beta-użytkownikami — zapytaj wprost
„czy przetestowałbyś Pro przez 14 dni?".

**Annual discount:** Tak, wdrożyć od startu. 32% dyskont jest powyżej standardowego
progu (20%), co może zwiększyć konwersję na roczny — ale testuj, czy klienci wolą
niższy miesięczny commitment.

#### Kroki walidacji ceny przed launchem

1. **Rozmowy z 5–10 technologami/inżynierami** (przez partnera branżowego) — zadaj pytanie:
   „Za ile miesięcznie kupiłbyś to narzędzie bez wahania?" i „Za ile nigdy?"
   (Metoda Van Westendorp — Price Sensitivity Meter).
2. **Landing page z ceną** przed pełnym launchem — mierz kliknięcia w "Wybierz Pro"
   nawet jeśli płatność nie jest jeszcze gotowa (fake door test).
3. **Pierwszy kwartał po launchem** — monitoruj współczynnik konwersji Free → Pro.
   Jeśli < 2% po 3 miesiącach, rozważ obniżenie ceny lub zmianę limitów Free/Pro.

#### Zależności

- Cena musi być skonfigurowana w Paddle przed launchem.
- Landing page powinien zawierać tabelę porównawczą planów z ceną zanim uruchomisz płatności.

</recommendations>

---

## Podsumowanie priorytetów i timeline

| Tydzień | Zadanie | Priorytet |
|---|---|---|
| 1–3 | Architektura + canvas MVP | — |
| 4–6 | Komponenty prymitywów + walidacja geometryczna | Walidacja: wdrożyć tu |
| 6–8 | Auth (Supabase) + zarządzanie projektami | — |
| 8–10 | Integracja Paddle, konfiguracja planów, ceny | Płatności: wdrożyć tu |
| 10–11 | Polityka prywatności, regulamin, cookie consent | GDPR: wdrożyć tu |
| 11–12 | Beta z użytkownikami, testy E2E, poprawki | Weryfikacja ceny |
| 12 | Launch 🚀 | — |

---

## Otwarte kwestie (nadal do ustalenia)

| Kwestia | Kiedy wrócić |
|---|---|
| Finalna cena Pro (walidacja z użytkownikami) | Po beta, przed launchem |
| Trial Pro: tak/nie i z kartą czy bez | Po rozmowach z beta-użytkownikami |
| Dostawca emaili transakcyjnych (Resend/Postmark) | Tydzień 7–8 |
| Analytics: Plausible vs GA vs combo | Tydzień 9–10 |
| DPA z Supabase i innymi procesorami | Po launchem, przed skalowaniem |
| Prawnik do weryfikacji regulaminu | Przed przekształceniem w spółkę |
| Strategia cenowa EUR na rynek EU | Po walidacji PLN na rynku PL |

---

*Dokument wygenerowany na podstawie sesji planowania PRD, 2026-04-22.*
*Wersja do weryfikacji — nie jest dokumentem prawnym ani finansowym.*
