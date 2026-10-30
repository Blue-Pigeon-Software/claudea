import { existsSync, lstatSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';

export function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Zwraca sparsowany JSON albo null, gdy pliku nie ma lub jest uszkodzony. */
export function readJson(p) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Zapis przez plik tymczasowy + rename, z zachowaniem uprawnień istniejącego pliku. */
export function writeJsonAtomic(p, data, { defaultMode = 0o600 } = {}) {
  let mode = defaultMode;
  try {
    mode = statSync(p).mode & 0o777;
  } catch { /* nowy plik */ }
  const tmp = `${p}.claudea-${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode });
  renameSync(tmp, p);
}
