import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { CliError } from './log.js';
import { claudeHome, configFile, home, isInside, legacyAccountsDirs, normalizeDir, tildify } from './paths.js';
import { accountsBaseDir, saveConfig } from './config.js';
import { isDirectory, isSymlink } from './fsutil.js';

// Nazwy poleceń są zarezerwowane, bo `claudea <nazwa>` uruchamia konto.
const RESERVED = new Set([
  'add', 'remove', 'rm', 'rename', 'order', 'list', 'ls', 'run', 'use', 'login', 'logout',
  'import', 'shell', 'help', 'version', 'ui',
]);
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Zwraca komunikat błędu albo undefined (format zgodny z `validate` w @clack/prompts). */
export function validateName(name, config) {
  if (!name) return 'Podaj nazwę konta.';
  if (!NAME_RE.test(name)) return 'Dozwolone: litery, cyfry, „-” i „_” (max 40 znaków, start od litery/cyfry).';
  if (RESERVED.has(name.toLowerCase())) return `Nazwa „${name}” jest zarezerwowana (to polecenie claudea).`;
  if (config && config.accounts.some((a) => sameName(a.name, name))) return `Konto „${name}” już istnieje.`;
  return undefined;
}

function assertValidName(name, config) {
  const error = validateName(name, config);
  if (error) throw new CliError(error);
}

/** Konta w kolejności ustawionej przez użytkownika (kopie wpisów rejestru). */
export function getAccounts(config) {
  return config.accounts.map((a) => ({ ...a }));
}

function findEntry(config, name) {
  const entry =
    config.accounts.find((a) => a.name === name) ?? config.accounts.find((a) => sameName(a.name, String(name)));
  if (!entry) {
    throw new CliError(`Nie ma konta „${name}”.`, {
      hint: config.accounts.length
        ? `Dostępne: ${config.accounts.map((a) => a.name).join(', ')}`
        : 'Nie masz jeszcze kont — dodaj: `claudea add <nazwa>`.',
    });
  }
  return entry;
}

/** Szuka konta po nazwie (dokładnie, a potem bez rozróżniania wielkości liter). */
export function findAccount(config, name) {
  return { ...findEntry(config, name) };
}

/** Konto wskazywane przez CLAUDE_CONFIG_DIR w bieżącym środowisku (albo null). */
export function activeAccount(accounts, env = process.env) {
  if (!env.CLAUDE_CONFIG_DIR) return null;
  const dir = normalizeDir(env.CLAUDE_CONFIG_DIR);
  return accounts.find((a) => a.dir === dir) ?? null;
}

export function defaultDirFor(config, name) {
  return join(accountsBaseDir(config), name);
}

function assertDirUsable(config, dir) {
  if (isInside(claudeHome(), dir) || isInside(dir, claudeHome())) {
    throw new CliError('Katalog konta nie może być standardowym ~/.claude ani leżeć w nim / nad nim.');
  }
  if (isInside(configFile(), dir)) {
    throw new CliError(`Katalog konta nie może zawierać rejestru claudea (${tildify(configFile())}).`);
  }
  const owner = config.accounts.find((a) => a.dir === dir);
  if (owner) throw new CliError(`Katalog ${tildify(dir)} należy już do konta „${owner.name}”.`);
}

/** Symlinki prowadzące do ~/.claude — takie konto nie jest niezależne. */
export function linksToClaudeHome(dir) {
  return readdirSync(dir).filter((entry) => {
    const p = join(dir, entry);
    return isSymlink(p) && isInside(resolve(dirname(p), readlinkSync(p)), claudeHome());
  });
}

export function createAccount(config, { name, dir }) {
  assertValidName(name, config);
  const target = normalizeDir(dir ?? defaultDirFor(config, name));
  assertDirUsable(config, target);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new CliError(`Katalog ${tildify(target)} już istnieje i nie jest pusty.`, {
      hint: 'Jeśli to istniejąca konfiguracja Claude Code, użyj `claudea import`.',
    });
  }

  mkdirSync(target, { recursive: true, mode: 0o700 });
  config.accounts.push({ name, dir: target, createdAt: new Date().toISOString() });
  saveConfig(config);
  return findAccount(config, name);
}

/** Usunięcie konta z rejestru i (opcjonalnie) jego katalogu. Wylogowanie robi wywołujący. */
export function removeAccount(config, name, { deleteFiles = true } = {}) {
  const account = findAccount(config, name);
  if (deleteFiles && existsSync(account.dir)) {
    assertSafeToDelete(config, account);
    // Ręcznie dodane symlinki odpinamy osobno, żeby na pewno nie ruszyć ich celów.
    for (const entry of readdirSync(account.dir)) {
      const p = join(account.dir, entry);
      if (isSymlink(p)) unlinkSync(p);
    }
    rmSync(account.dir, { recursive: true, force: true });
  }
  config.accounts = config.accounts.filter((a) => a.name !== account.name);
  saveConfig(config);
  return account;
}

function assertSafeToDelete(config, account) {
  const dir = account.dir;
  const depth = dir.split(sep).filter(Boolean).length;
  if (
    depth < 2 ||
    dir === home() ||
    isInside(claudeHome(), dir) ||
    isInside(dir, claudeHome()) ||
    isInside(configFile(), dir)
  ) {
    throw new CliError(`Odmawiam usunięcia ${tildify(dir)} — to wygląda na katalog systemowy, ~/.claude lub ~/.claudea.`);
  }
  if (lstatSync(dir).isSymbolicLink()) {
    throw new CliError(`${tildify(dir)} jest symlinkiem — usuń go ręcznie albo użyj --keep-files.`);
  }
  const nested = config.accounts.find((a) => a.name !== account.name && isInside(a.dir, dir));
  if (nested) throw new CliError(`W ${tildify(dir)} leży katalog konta „${nested.name}” — przerywam.`);
}

/**
 * Zmienia tylko nazwę (pozycja na liście zostaje). Katalogu nie przenosimy: Keychain identyfikuje
 * poświadczenia po hashu ścieżki, więc przeniesienie wymusiłoby ponowne logowanie.
 */
export function renameAccount(config, oldName, newName) {
  const entry = findEntry(config, oldName);
  assertValidName(newName, sameName(entry.name, newName) ? null : config);
  entry.name = newName;
  saveConfig(config);
  return findAccount(config, newName);
}

/**
 * Ustawia kolejność kont. `names` to konta, które mają być na początku (w tej kolejności);
 * pozostałe zachowują dotychczasową kolejność za nimi.
 */
export function reorderAccounts(config, names) {
  const picked = names.map((n) => findEntry(config, n));
  const duplicate = picked.find((entry, i) => picked.indexOf(entry) !== i);
  if (duplicate) throw new CliError(`Konto „${duplicate.name}” podano więcej niż raz.`);
  config.accounts = [...picked, ...config.accounts.filter((a) => !picked.includes(a))];
  saveConfig(config);
  return getAccounts(config);
}

export function importAccount(config, { dir, name }) {
  const target = normalizeDir(dir);
  if (!isDirectory(target)) throw new CliError(`${tildify(target)} nie jest katalogiem.`);
  const accountName = name ?? suggestName(config, target);
  assertValidName(accountName, config);
  assertDirUsable(config, target);
  const links = linksToClaudeHome(target);
  if (links.length > 0) {
    throw new CliError(`${tildify(target)} zawiera symlinki do ~/.claude (${links.join(', ')}) — nie jest niezależny.`, {
      hint: 'Usuń te symlinki (konto zacznie z czystą konfiguracją) i zaimportuj ponownie.',
    });
  }

  config.accounts.push({ name: accountName, dir: target, createdAt: new Date().toISOString() });
  saveConfig(config);
  return findAccount(config, accountName);
}

const CONFIG_MARKERS = ['.claude.json', 'settings.json', 'projects', 'plugins', 'history.jsonl', 'sessions', '.credentials.json'];

function looksLikeClaudeConfig(dir) {
  try {
    return readdirSync(dir).some((e) => CONFIG_MARKERS.includes(e));
  } catch {
    return false;
  }
}

/**
 * Niezarejestrowane katalogi konfiguracyjne Claude Code: podkatalogi `accountsDir` (~/.claudea),
 * ~/.claude-accounts oraz ~/.claude-* (układ z gista). Pomija katalogi zależne od ~/.claude.
 */
export function findImportCandidates(config) {
  const known = new Set(config.accounts.map((a) => a.dir));
  const base = accountsBaseDir(config);
  const dirs = new Set();

  const scan = (parent, filter) => {
    try {
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory() && filter(entry.name)) dirs.add(normalizeDir(join(parent, entry.name)));
      }
    } catch { /* katalog nie istnieje */ }
  };
  scan(base, () => true);
  for (const legacy of legacyAccountsDirs()) scan(legacy, () => true);
  scan(home(), (n) => n.startsWith('.claude-'));

  const taken = new Set(config.accounts.map((a) => a.name.toLowerCase()));
  const candidates = [];
  for (const dir of [...dirs].sort()) {
    if (dir === base || known.has(dir) || !looksLikeClaudeConfig(dir) || linksToClaudeHome(dir).length > 0) continue;
    const suggestedName = suggestName(config, dir, taken);
    taken.add(suggestedName.toLowerCase());
    candidates.push({ dir, suggestedName });
  }
  return candidates;
}

function suggestName(config, dir, taken = new Set(config.accounts.map((a) => a.name.toLowerCase()))) {
  let base = basename(dir).replace(/^\.claude-/, '').replace(/^\./, '');
  base = base.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^[-_]+/, '').slice(0, 36) || 'konto';
  if (RESERVED.has(base.toLowerCase())) base = `${base}-acc`;
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}-${i}`;
  return name;
}
