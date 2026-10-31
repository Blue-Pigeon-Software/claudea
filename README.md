# claudea

[![npm](https://img.shields.io/npm/v/claudea)](https://www.npmjs.com/package/claudea)

Interaktywny menedżer wielu kont Claude Code na jednym komputerze.

Każde konto jest **całkowicie niezależne**: dostaje własny katalog konfiguracyjny
(`CLAUDE_CONFIG_DIR`, domyślnie `~/.claudea/<nazwa>`) z osobnym logowaniem, ustawieniami,
pluginami, skillami, serwerami MCP i historią. Standardowy `~/.claude` nie jest ani używany, ani modyfikowany.
Kilka kont może działać jednocześnie w różnych kartach terminala.

## Instalacja

Wymagania: Node.js ≥ 22.13, zainstalowany Claude Code (`claude` w `PATH`), macOS lub Linux.

### Z npm (zalecane)

```bash
npm install -g claudea
claudea
```

- aktualizacja: `npm install -g claudea@latest`
- odinstalowanie: `npm uninstall -g claudea` (konta w `~/.claudea` zostają na dysku)
- bez instalacji: `npx claudea`

### Z kodu źródłowego

```bash
git clone https://github.com/Blue-Pigeon-Software/claudea.git && cd claudea
npm install
node bin/claudea.js        # albo: npm start
```

Opcjonalnie `npm link` udostępnia wersję z repozytorium jako polecenie `claudea` (cofnięcie: `npm unlink -g claudea`).

## Użycie

Uruchamiasz `claudea`. Menu działa na osobnym ekranie terminala, jak aplikacja: po wyjściu terminal wygląda
tak jak przed uruchomieniem i nic nie zostaje w historii. Na górze jest lista kont, a pod nią, w osobnej sekcji, ustawienia:

```
┌  claudea — menedżer niezależnych kont Claude Code
│
◆  Wybierz konto, aby uruchomić Claude Code
│  ● praca      jan@firma.pl · Firma · max (~/.claudea/praca)
│  ○ prywatne   niezalogowane
│
│  ── Ustawienia ──────────────────────
│  › Dodaj konto
│  › Zaloguj konto
│  › Wyloguj konto
│  › Zmień kolejność kont
│  › Zmień nazwę konta
│  › Usuń konto
│  › Włącz integrację z powłoką
│
│  › Wyjście
│  ↑/↓ wybór • Enter: uruchom • Esc: wyjdź
└
```

Enter na koncie zamyka ekran menu i startuje `claude` z `CLAUDE_CONFIG_DIR` tego konta. Sesja działa w tym samym
terminalu, a po jej zakończeniu `claudea` też się kończy (z kodem wyjścia `claude`).

**Kolejność kont** ustawiasz w „Zmień kolejność kont”: Spacja chwyta konto, ↑/↓ je przesuwa,
Spacja upuszcza, Enter zapisuje. Nowe konta trafiają na koniec listy, zmiana nazwy nie zmienia pozycji.

To samo bez menu (np. do skryptów):

| Polecenie | Opis |
|---|---|
| `claudea <konto> [arg.]` | uruchom Claude Code na koncie, argumenty trafiają do `claude` bez zmian (np. `claudea praca -c`) |
| `claudea list [--json]` | konta, katalogi i stan logowania (e-mail, organizacja, plan) |
| `claudea add <nazwa> [--dir <ścieżka>] [--no-login] [--email <e>]` | nowe konto |
| `claudea remove <nazwa> [--yes] [--keep-files] [--no-logout]` | wyloguj i usuń katalog konta (albo tylko wyrejestruj) |
| `claudea rename <stara> <nowa>` | zmiana nazwy (katalog, logowanie i pozycja zostają) |
| `claudea order [<konto>…]` | kolejność kont: podane konta trafiają na początek w tej kolejności, reszta za nimi |
| `claudea import [<katalog>] [--name <n>] [--all]` | dodaj istniejący katalog konfiguracyjny Claude Code |
| `claudea run <konto> [--] [arg.]` | jawna forma uruchomienia |
| `claudea login <konto> [--email <e>] [--sso] [--console]` | `claude auth login` na koncie |
| `claudea logout <konto>` | `claude auth logout` na koncie |

| `claudea shell [status\|on\|off]` | integracja z powłoką (zob. niżej) |

## Integracja z powłoką (opcjonalna)

Jeśli używasz `npx claudea` zamiast instalacji globalnej, możesz włączyć krótsze polecenie: po wpisaniu `claudea`
uruchomi się `npx claudea`. Włączasz i wyłączasz to w menu („Włącz/Wyłącz integrację z powłoką”) albo przez
`claudea shell on` / `claudea shell off`.

Domyślnie integracja jest wyłączona i claudea nie zmienia wtedy plików startowych powłoki. Po włączeniu dopisuje
do pliku startowego bieżącej powłoki (`$SHELL`: zsh → `~/.zshrc`, bash → `~/.bash_profile` na macOS i `~/.bashrc`
na Linuksie, fish → `~/.config/fish/config.fish`) oznaczony blok, a przy wyłączaniu usuwa tylko ten blok:

```bash
# >>> claudea >>>
alias claudea='npx claudea'
# <<< claudea <<<
```

Zmiana obowiązuje w nowych terminalach; w otwartych wykonaj polecenie, które podpowie claudea. `npx` wybiera wersję
z bieżącego projektu albo ze swojej pamięci podręcznej, więc alias nie musi uruchamiać najnowszego wydania.

## Import istniejących kont

Jeśli masz już katalogi zrobione ręcznie (np. według gista: `~/.claude-account1`, albo `~/.claude-accounts/<nazwa>`),
„Importuj istniejące katalogi” w menu (lub `claudea import`) je znajdzie i doda do rejestru **bez przenoszenia** —
logowanie zostaje, bo Claude Code wiąże poświadczenia z dokładną ścieżką katalogu. Katalogi z symlinkami do
`~/.claude` (z narzędzia `claude-code-accounts`) są pomijane, bo nie są niezależne.

## Jak to działa

- Rejestr kont: `~/.claudea/config.json` (lista kont w kolejności z menu). Katalogi kont: `~/.claudea/<nazwa>` (prawa 0700).
- Uruchomienie konta to `claude` z ustawionym `CLAUDE_CONFIG_DIR` — claudea tylko czeka na koniec sesji.
- Stan logowania pochodzi z `claude auth status --json`, logowanie i wylogowanie z `claude auth login/logout`.
- Na macOS poświadczenia trafiają do Keychain pod nazwą zależną od ścieżki katalogu, dlatego **nie przenoś
  katalogów kont ręcznie** (po przeniesieniu trzeba się zalogować ponownie). `rename` zmienia tylko nazwę.
- Wspólne pozostaje tylko to, co i tak należy do projektu: pliki `.claude/` i `CLAUDE.md` w repozytoriach.

## Rozwój

Zob. [AGENTS.md](AGENTS.md) — architektura, konwencje, wiedza o Claude Code i zasady testowania.

```bash
npm test        # testy e2e na tymczasowym HOME z atrapą `claude`
npm run check
```

Każdy push i PR przechodzi testy w GitHub Actions. Nowe wersje publikuje automatycznie workflow **Release**
(npm Trusted Publishing): `npm version patch|minor|major && git push --follow-tags` albo
Actions → Release → Run workflow.

## Źródła

- [Manage Multiple Claude Code Accounts](https://gist.github.com/KMJ-007/0979814968722051620461ab2aa01bf2) (KMJ-007) — model „osobny `CLAUDE_CONFIG_DIR` na konto”.
- [claude-code-accounts](https://github.com/manikandan-22/claude-code-accounts) (Manikandan Annamalai, MIT) — inspiracja dla poleceń CLI.
