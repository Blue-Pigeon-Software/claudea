# AGENTS.md — claudea

Instrukcje dla agentów (Claude Code, Codex itp.) i ludzi pracujących nad projektem.
Aktualizuj ten plik przy każdej zmianie architektury, poleceń, formatu danych lub konwencji.

## Czym jest claudea

CLI w Node.js (`claudea`) — interaktywny menedżer wielu kont Claude Code na jednej maszynie.
**Każde konto jest całkowicie niezależne**: to osobny katalog `CLAUDE_CONFIG_DIR`
(domyślnie `~/.claudea/<nazwa>`) z własnym logowaniem, ustawieniami, pluginami, skillami i historią.

- **Standardowy `~/.claude` (i `~/.claude.json`) NIE jest używany** — ani do odczytu, ani do zapisu,
  ani jako cel symlinków. Ścieżka `~/.claude` pojawia się w kodzie wyłącznie w zabezpieczeniach
  (konto nie może w nim leżeć; import pomija katalogi z symlinkami do niego). Test
  „niezależność od ~/.claude” w `test/accounts.test.js` pilnuje tego automatycznie.
- `claude` zawsze dostaje `CLAUDE_CONFIG_DIR` konta (nadpisuje wartość odziedziczoną z powłoki).
- **Jedynym punktem wejścia jest `claudea`** — użytkownik uruchamia menu i tam wybiera konto.
  Nie ma aliasów ani funkcji per konto (`claude-<konto>`) ani poleceń `shell-init`, `env` (usunięte na prośbę
  właściciela). Nie dodawaj tego z powrotem bez wyraźnej prośby.
- Jedyna integracja z powłoką to opcjonalny, domyślnie wyłączony alias `claudea` → `npx claudea`
  (`claudea shell on|off`, pozycja w menu, `src/shell.js`). Bez jawnego włączenia claudea nie modyfikuje plików startowych
  powłoki; przy wyłączaniu usuwa tylko własny blok między znacznikami `# >>> claudea >>>` i `# <<< claudea <<<`.
  Plik startowy może być symlinkiem (dotfiles) — zapis trafia do jego celu, a symlink zostaje.

Źródła pomysłu:
- gist KMJ-007 „Manage Multiple Claude Code Accounts” — osobny `CLAUDE_CONFIG_DIR` na konto (to jest nasz model;
  aliasy z gista zastępuje menu `claudea`),
- `manikandan-22/claude-code-accounts` (MIT) — CLI `claude-acc`; wzięliśmy z niego ergonomię poleceń
  (`add/remove/list`), ale **świadomie odrzuciliśmy** współdzielenie przez symlinki do `~/.claude`
  oraz integrację `shell-init` (decyzje właściciela z 2026-10-30).

## Szybki start dla developera

```bash
npm install          # zależności: @clack/prompts + @clack/core (ta sama wersja, której używa prompts)
npm test             # node:test, ~2 s, wszystko na tymczasowym HOME
npm run check        # node --check wszystkich plików + testy
node bin/claudea.js  # albo `npm start` — menu
```

Nie uruchamiaj `npm link` / `npm install -g` na maszynie użytkownika bez pytania (właściciel woli uruchamiać z katalogu projektu).

Ręczne próby **zawsze w piaskownicy**, nigdy na prawdziwym `HOME` użytkownika:

```bash
export HOME=$(mktemp -d) CLAUDEA_CLAUDE_BIN=$PWD/test/fixtures/fake-claude.js
node bin/claudea.js add praca --no-login
node bin/claudea.js login praca --email a@b.pl   # atrapa zapisze oauthAccount
node bin/claudea.js list
```

## Struktura

```
.github/workflows/    ci.yml (testy), release.yml (publikacja w npm przez OIDC)
bin/claudea.js        punkt wejścia (shebang) → src/cli.js main()
src/cli.js            parsowanie argumentów (node:util parseArgs), dispatch poleceń, tekst pomocy
src/interactive.js    menu (ładowane leniwie — tylko gdy TTY i brak polecenia): konta na górze, akcje pod separatorem
src/ui.js             własne prompty na @clack/core: menuSelect (separatory, polska stopka), sortList (zmiana kolejności)
src/accounts.js       rejestr kont: walidacja nazw, create/remove/rename/reorder/import, kandydaci do importu
src/claude.js         uruchamianie `claude` (spawn, stdio: inherit), `claude auth status|login|logout`
src/shell.js          opcjonalny alias claudea → npx claudea w pliku startowym powłoki (zsh, bash, fish)
src/config.js         odczyt/zapis rejestru ~/.claudea/config.json
src/paths.js          wszystkie ścieżki (leniwie z $HOME), normalizeDir, tildify, isInside
src/format.js         tabela kont i opis stanu logowania
src/fsutil.js         drobne helpery fs (atomowy zapis JSON, isSymlink…)
src/log.js            CliError, kolory (util.styleText), ok/info/warn/fail
test/*.test.js        testy e2e: spawn CLI z tymczasowym HOME (test/helpers.js → sandbox())
test/fixtures/fake-claude.js   atrapa `claude` (loguje wywołania, emuluje `auth *`)
```

## Dane i pliki

- Rejestr: `~/.claudea/config.json` (nadpisywany atomowo: tmp + rename, tryb 0600):
  ```json
  { "version": 1, "accounts": [{ "name": "praca", "dir": "/Users/x/.claudea/praca", "createdAt": "…" }], "accountsDir": "opcjonalnie" }
  ```
  - `accounts` to **tablica — jej kolejność jest kolejnością kont w menu** (ustawianą przez „Zmień kolejność kont” /
    `claudea order`). Nowe konto → `push` na koniec; `rename` zmienia nazwę w miejscu; nigdy nie sortuj alfabetycznie.
  - Wczesna wersja zapisywała `accounts` jako obiekt `{ <nazwa>: {...} }` — `loadConfig()` go wczytuje,
    a pierwszy zapis zamienia na tablicę (test „rejestr w starym formacie”).
  - `accountsDir` (opcjonalny) zmienia miejsce tworzenia nowych kont. Uszkodzony rejestr → błąd, **nigdy** nie nadpisujemy go pustym.
- Katalogi kont: `~/.claudea/<nazwa>` (0700). Nazwa w rejestrze jest niezależna od katalogu (rename nie przenosi katalogu).

Zmienne środowiskowe: `CLAUDEA_CONFIG` (inna ścieżka rejestru), `CLAUDEA_CLAUDE_BIN` (inna binarka claude).
Tylko testy: `FAKE_CLAUDE_LOG`, `FAKE_CLAUDE_EXIT`.

## Wiedza o Claude Code (zweryfikowana na v2.1.314, macOS)

- `CLAUDE_CONFIG_DIR=<dir>` przenosi całą konfigurację, także plik stanu: `<dir>/.claude.json` zamiast `~/.claude.json`.
- Poświadczenia OAuth na macOS są w Keychain, usługa `Claude Code-credentials-<8 znaków hex>`, gdzie sufiks to
  `sha256(CLAUDE_CONFIG_DIR.normalize('NFC'))` — **z dokładnego stringu ścieżki**. Bez `CLAUDE_CONFIG_DIR`
  (konto standardowe) nazwa nie ma sufiksu. Wnioski:
  - ścieżki zawsze przepuszczaj przez `normalizeDir()` (bezwzględna, bez końcowego `/`, NFC),
  - przeniesienie/zmiana ścieżki katalogu konta = utrata logowania (dlatego `rename` zmienia tylko nazwę),
  - na Linuksie (lub bez Keychain) poświadczenia leżą w `<dir>/.credentials.json`.
- Oficjalny interfejs, którego używamy zamiast grzebania w Keychain:
  - `claude auth status --json` → `{ loggedIn, authMethod, email, orgName, subscriptionType, … }`, ~0,1 s;
    **kod wyjścia 1, gdy niezalogowany** (JSON i tak jest na stdout);
    efekt uboczny: tworzy brakujący katalog i `.claude.json`/`.claude.json.lock`/`backups` — dlatego
    `authStatus()` nie wywołuje go dla nieistniejącego katalogu konta.
  - `claude auth login [--email <e>] [--sso] [--console]`, `claude auth logout`.
- `oauthAccount` w `<dir>/.claude.json` (pola m.in. `emailAddress`, `organizationName`) służy jako awaryjne
  źródło stanu, gdy `claude` jest niedostępny (`loggedIn: null` = „nieznany”).

## Konwencje kodu

- ESM, Node ≥ 22.13 (`parseArgs` z `allowNegative`, `util.styleText`). Bez TypeScriptu i bez bundlera.
- Zależności runtime: `@clack/prompts` i `@clack/core` (wersja core musi być tą samą, którą przypina prompts —
  inaczej npm zainstaluje dwie kopie z osobnymi `settings`). Ładuj je **leniwie** (`interactive.js`/`ui.js` przez
  `await import(...)`) — polecenia nieinteraktywne (`list`, `run`…) mają startować szybko i działać bez TTY.
- Wybory w menu rób przez `menuSelect()` z `ui.js` (polska stopka, separatory `{ separator: true }`), nie `p.select`
  (ma angielską stopkę). `p.text`/`p.confirm` (przez `yesNo()`)/`p.multiselect` (z `showInstructions: false`) są OK.
- Teksty UI, komunikaty błędów i komentarze **po polsku** (z poprawnymi znakami diakrytycznymi);
  identyfikatory, nazwy plików i poleceń po angielsku. Potwierdzenia: „Tak / Nie” (`yesNo()` w interactive.js).
- Logika w `accounts.js`/`claude.js` nie wypisuje nic na ekran — zwraca dane albo rzuca `CliError(msg, { hint })`.
  Wypisywaniem zajmują się `cli.js` (tryb poleceń) i `interactive.js` (menu).
- Bezpieczeństwo operacji na plikach:
  - usuwanie konta przechodzi przez `assertSafeToDelete()` (nie HOME, nie `~/.claude`, nie katalog z rejestrem,
    nie symlink, nie katalog zawierający inne konto) i odpina symlinki przed `rmSync`,
  - `runClaude()` dziedziczy terminal i ignoruje SIGINT/SIGQUIT w rodzicu (obsługuje je claude), SIGTERM/SIGHUP przekazuje dziecku.
- Nazwy kont: `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$`, unikalne bez względu na wielkość liter, nie mogą być nazwą
  polecenia (`RESERVED` w accounts.js), bo `claudea <konto>` jest skrótem `claudea run <konto>`.

## Testy

- `npm test` uruchamia `node --test "test/*.test.js"` (glob celowo pomija `test/fixtures/` i `test/helpers.js`).
- Każdy test e2e tworzy `sandbox()`: tymczasowy HOME z przykładowym `~/.claude` (żeby sprawdzać, że jest nietknięty),
  czyste env (bez `CLAUDE_CONFIG_DIR`/`ZDOTDIR` użytkownika), atrapę claude. `sb.calls()` zwraca wywołania atrapy
  (`args`, `configDir`), `sb.config()` — rejestr.
- Testy pilnują też, że bez `shell on` claudea nie tworzy/nie zmienia plików startowych powłoki oraz że nie zmienia niczego w `~/.claude`.
  Testy `shell` podają `SHELL` przez `env`, bo sandbox go nie dziedziczy.
- Tryb interaktywny nie ma testów automatycznych. Ręcznie: pseudo-terminal (np. Python `pty.fork()`);
  **koniecznie ustaw rozmiar okna** (`TIOCSWINSZ`), inaczej clack renderuje po jednym znaku w linii.

## Checklista: nowe polecenie / zmiana zachowania

1. Implementacja w module domenowym (bez wypisywania), obsługa w `cli.js` (`COMMANDS` + `HELP`).
2. Jeśli ma sens w menu — akcja w `ACTIONS` i pozycja w `menuOptions()` w `interactive.js`.
3. Nowa nazwa polecenia → dopisz do `RESERVED` w `accounts.js`.
4. Testy e2e w `test/` (sandbox + atrapa claude), `npm run check` na zielono.
5. Zaktualizuj `README.md` i ten plik (struktura, dane, wiedza o Claude Code, dziennik decyzji).

## Wydanie nowej wersji (npm) — automatycznie przez GitHub Actions

Pakiet: [`claudea`](https://www.npmjs.com/package/claudea), maintainer `ardecht`; repo: `Blue-Pigeon-Software/claudea` (gałąź `main`).

Publikuje workflow `.github/workflows/release.yml` przez **npm Trusted Publishing (OIDC)** — bez tokenów npm
w sekretach i bez 2FA przy każdym wydaniu. Połączenie po stronie npm (claudea → Settings → Trusted Publisher):
GitHub Actions, `Blue-Pigeon-Software` / `claudea` / workflow `release.yml`, bez environmentu, dozwolone `npm publish`.
Wszystkie pola są case-sensitive; **zmiana nazwy pliku workflowu albo repo wymaga nowego połączenia w npm**.
„Publishing access” pakietu: **Require two-factor authentication and disallow bypass 2fa tokens** — publikacja
klasycznymi/granularnymi tokenami jest zablokowana; działa tylko Trusted Publishing z CI albo ręczna publikacja z 2FA.
Nie dodawaj tokenów npm do sekretów repozytorium — i tak nie zadziałają.

Sposoby wydania:
1. Lokalnie: `npm run check` → `npm version patch|minor|major` (commit + tag `vX.Y.Z`) → `git push --follow-tags`.
   Push tagu uruchamia `release.yml`: testy, kontrola tag == wersja w `package.json`, `npm publish`, GitHub Release.
2. Z GitHuba: Actions → **Release** → Run workflow (gałąź `main`, wybór `patch|minor|major`). Workflow podbija wersję,
   publikuje w npm, a dopiero potem wypycha commit „Wydanie X.Y.Z” i tag (atomowo) oraz tworzy GitHub Release.
   Opcja `dry_run` robi wszystko poza publikacją, pushem i Release (`npm publish --dry-run`).
   Commity/tagi wypchnięte przez `GITHUB_TOKEN` nie uruchamiają ponownie workflowów — nie ma podwójnej publikacji.

`ci.yml` uruchamia `npm run check` przy każdym pushu na `main` i w PR (Ubuntu + macOS, Node 22 + 24).

Wymagania Trusted Publishing: npm CLI ≥ 11.5.1 (workflow sam aktualizuje npm), `permissions: id-token: write`,
runner hostowany przez GitHub, `repository.url` w `package.json` = to repo. Provenance generuje się automatycznie
(publiczne repo + publiczny pakiet). Błąd `E404`/`ENEEDAUTH` przy publikacji = niezgodna konfiguracja połączenia.

Po publikacji npm przez kilka minut przetwarza paczkę — rejestr i npmjs.com pokazują wtedy starą wersję.
Sprawdzaj `npm view claudea dist-tags --prefer-online`. Wersja `0.0.0-stage` to placeholder z pierwszej publikacji
nowego pakietu (staged publishing).

Awaryjnie (ręcznie z komputera właściciela): `npm publish` wymaga 2FA kluczem bezpieczeństwa potwierdzanego
w przeglądarce (agent nie potwierdza 2FA). Bez TTY npm kończy się `EOTP` — uruchom w pseudo-terminalu (Python `pty`)
albo poproś właściciela o `! npm publish`. Sukces to linia `+ claudea@X.Y.Z`; w pty npm potem nie kończy procesu
sam, więc skrypt musi go zakończyć (szukaj tekstu w wyjściu oczyszczonym z kodów ANSI).

Paczka zawiera tylko `bin/`, `src/`, `README.md`, `LICENSE` (pole `files`) — sprawdzaj `npm pack --dry-run`.

## Dziennik decyzji

- 2026-10-30 — Projekt utworzony. Konta w `~/.claudea/<nazwa>`, rejestr w `~/.claudea/config.json`.
- 2026-10-30 — Rezygnacja z trybu „wspólnego” (symlinki do `~/.claude`) i z pseudo-konta „default”:
  każda instancja jest totalnie niezależna, `~/.claude` nie jest używany. Import pomija/odrzuca katalogi
  z symlinkami do `~/.claude` (układ `claude-code-accounts`).
- 2026-10-30 — Menu główne: najpierw lista kont (Enter = uruchom `claude`), pod separatorem akcje.
  Dodane ustawianie kolejności kont (`sortList`, `claudea order`); rejestr trzyma konta jako tablicę.
- 2026-10-30 — Usunięta integracja z powłoką (`shell install/uninstall`, `shell-init`, `env`, funkcje
  `claude-<konto>`/`claudea-use`). Zawsze uruchamiamy `claudea` i wybieramy konto w menu.
- 2026-10-30 — Stan logowania i (wy)logowanie wyłącznie przez `claude auth …`, nie przez bezpośrednie operacje na Keychain.
- 2026-10-30 — Repozytorium publiczne `Blue-Pigeon-Software/claudea`, licencja MIT, pakiet npm `claudea` (0.1.0).
- 2026-10-30 — Wydanie 1.0.0 (tag `v1.0.0`, `latest` w npm).
- 2026-10-30 — Automatyzacja: CI (`ci.yml`) i wydania przez GitHub Actions + npm Trusted Publishing (`release.yml`),
  pełna automatyka (dozwolone `npm publish`, bez ręcznego zatwierdzania). Pierwsze wydanie z CI: 1.0.1.
  Publikacja tokenami zablokowana w ustawieniach pakietu.
- 2026-10-30 — Na prośbę właściciela wraca wąska integracja z powłoką: przełączany alias `claudea` → `npx claudea`
  (menu, `claudea shell on|off`), domyślnie wyłączony. Aliasy per konto i `shell-init`/`env` nadal odrzucone.

## Pomysły na później

- `claudea doctor` (zerwane/nieistniejące katalogi kont, brak `claude` w PATH).
- Kopiowanie wybranych ustawień przy tworzeniu konta z innego konta claudea (jednorazowo, bez symlinków).
- Testy automatyczne trybu interaktywnego przez pty (menu, `sortList`).
