import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { CliError } from './log.js';
import { shellRcFiles, tildify } from './paths.js';
import { writeTextAtomic } from './fsutil.js';

// Blok w pliku startowym powłoki. Znaczniki pozwalają usunąć wyłącznie to, co dopisała claudea.
const BEGIN = '# >>> claudea >>>';
const END = '# <<< claudea <<<';
// Ta sama składnia działa w zsh, bash i fish.
const BLOCK = `${BEGIN}\nalias claudea='npx claudea'\n${END}\n`;

const hasBlock = (text) => text.split('\n').includes(BEGIN);

function removeBlocks(text, file) {
  const lines = text.split('\n');
  for (let start; (start = lines.indexOf(BEGIN)) !== -1; ) {
    const end = lines.indexOf(END, start);
    if (end === -1) {
      throw new CliError(`W ${tildify(file)} jest „${BEGIN}” bez „${END}” — nie zmieniam tego pliku.`, {
        hint: 'Usuń ten fragment ręcznie.',
      });
    }
    lines.splice(start, end - start + 1);
    // Pusta linia, którą oddzieliliśmy blok dopisany na końcu pliku.
    if (start > 0 && start === lines.length - 1 && lines[start - 1] === '') lines.splice(start - 1, 1);
  }
  return lines.join('\n');
}

/** Zmienia plik startowy; symlink (np. do repozytorium dotfiles) zostaje, zapis trafia do jego celu. */
function editRcFile(file, edit) {
  try {
    const target = existsSync(file) ? realpathSync(file) : file;
    const before = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const after = edit(before);
    if (after === before) return false;
    mkdirSync(dirname(target), { recursive: true });
    writeTextAtomic(target, after, { defaultMode: 0o644 });
    return true;
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`Nie można zmienić ${tildify(file)}: ${err.message}`);
  }
}

function fileHasBlock(file) {
  try {
    return hasBlock(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

/** Stan integracji dla bieżącej powłoki; `file: null` oznacza powłokę nieobsługiwaną. */
export function shellStatus(env = process.env) {
  const shell = env.SHELL ? basename(env.SHELL) : null;
  const file = shellRcFiles()[shell] ?? null;
  return { shell, file, enabled: file !== null && fileHasBlock(file) };
}

/** Dopisuje alias do pliku startowego bieżącej powłoki. */
export function enableShellIntegration(env = process.env) {
  const { shell, file } = shellStatus(env);
  if (!file) {
    throw new CliError(`Nieobsługiwana powłoka: ${shell ?? 'nieznana (brak $SHELL)'}.`, {
      hint: 'Obsługiwane: zsh, bash, fish.',
    });
  }
  const changed = editRcFile(file, (text) => {
    if (hasBlock(text)) return text;
    const separator = text === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    return `${text}${separator}${BLOCK}`;
  });
  return { changed, file, hint: `Działa w nowych terminalach; w tym wykonaj: source ${tildify(file)}` };
}

/** Usuwa alias ze wszystkich obsługiwanych plików — także po zmianie domyślnej powłoki. */
export function disableShellIntegration(env = process.env) {
  const files = Object.values(shellRcFiles()).filter((file) => editRcFile(file, (text) => removeBlocks(text, file)));
  const unalias = basename(env.SHELL ?? '') === 'fish' ? 'functions --erase claudea' : 'unalias claudea';
  return { files, hint: `Otwarte terminale zachowują alias do zamknięcia; w tym wykonaj: ${unalias}` };
}
