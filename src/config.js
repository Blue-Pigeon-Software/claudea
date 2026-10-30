import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CliError } from './log.js';
import { configFile, defaultAccountsDir, normalizeDir, tildify } from './paths.js';
import { writeJsonAtomic } from './fsutil.js';

/**
 * Rejestr kont: `{ version, accountsDir?, accounts: [{ name, dir, createdAt }] }`.
 * Kolejność tablicy = kolejność kont w menu. Brak pliku = pusty rejestr.
 */
export function loadConfig() {
  const file = configFile();
  let raw = {};
  if (existsSync(file)) {
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      // Nie nadpisujemy uszkodzonego rejestru — straciłoby się listę kont.
      throw new CliError(`Nie można odczytać ${tildify(file)}: ${err.message}`, {
        hint: 'Popraw lub usuń ten plik ręcznie.',
      });
    }
  }
  // Wczesna wersja trzymała konta jako obiekt { <nazwa>: {...} } — wczytujemy go i przy zapisie zamieniamy na tablicę.
  const entries = Array.isArray(raw.accounts)
    ? raw.accounts
    : Object.entries(raw.accounts ?? {}).map(([name, entry]) => ({ ...entry, name }));
  const accounts = entries
    .filter((a) => a && typeof a.name === 'string' && typeof a.dir === 'string')
    .map(({ name, dir, createdAt }) => ({ name, dir, createdAt }));
  return {
    version: 1,
    accountsDir: typeof raw.accountsDir === 'string' ? raw.accountsDir : null,
    accounts,
  };
}

export function saveConfig(config) {
  const { accountsDir, ...rest } = config;
  mkdirSync(dirname(configFile()), { recursive: true, mode: 0o700 });
  writeJsonAtomic(configFile(), accountsDir ? { ...rest, accountsDir } : rest);
}

/** Katalog, w którym tworzymy nowe konta (`accountsDir` w rejestrze, domyślnie ~/.claudea). */
export const accountsBaseDir = (config) =>
  config.accountsDir ? normalizeDir(config.accountsDir) : defaultAccountsDir();
