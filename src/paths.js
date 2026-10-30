import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

// Wszystkie ścieżki liczone leniwie z $HOME — testy podmieniają HOME na katalog tymczasowy.

export const home = () => homedir();

/**
 * Standardowy katalog Claude Code. claudea go NIE używa — służy tylko do zabezpieczeń
 * (konto nie może w nim leżeć, import pomija katalogi z symlinkami do niego).
 */
export const claudeHome = () => join(home(), '.claude');

/** Katalog claudea: rejestr + domyślne miejsce na katalogi kont (`~/.claudea/<nazwa>`). */
export const claudeaHome = () => join(home(), '.claudea');

/** Rejestr kont claudea. */
export const configFile = () =>
  process.env.CLAUDEA_CONFIG ? normalizeDir(process.env.CLAUDEA_CONFIG) : join(claudeaHome(), 'config.json');

export const defaultAccountsDir = () => claudeaHome();

/** Dodatkowe miejsca skanowane przy imporcie (ręczny układ sprzed claudea). */
export const legacyAccountsDirs = () => [join(home(), '.claude-accounts')];

export function expandHome(p) {
  if (p === '~') return home();
  if (p.startsWith('~/')) return join(home(), p.slice(2));
  return p;
}

export function tildify(p) {
  const h = home();
  if (p === h) return '~';
  if (p.startsWith(h + sep)) return `~${p.slice(h.length)}`;
  return p;
}

/**
 * Ścieżka bezwzględna, bez końcowego „/”, w NFC.
 * Claude Code liczy nazwę wpisu w Keychain z sha256 dokładnego stringu CLAUDE_CONFIG_DIR,
 * więc ta sama ścieżka musi zawsze mieć tę samą postać.
 */
export function normalizeDir(p) {
  return resolve(expandHome(p)).normalize('NFC');
}

/** Czy `child` leży wewnątrz `parent` (lub jest nim). */
export function isInside(child, parent) {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}
