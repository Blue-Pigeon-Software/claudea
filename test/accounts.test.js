import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.js';

/** Zrzut drzewa (ścieżka → rozmiar/mtime/treść) do porównań „nic się nie zmieniło”. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[p] = `${statSync(p).mtimeMs}:${readFileSync(p, 'utf8')}`;
    }
  };
  walk(dir);
  return out;
}

describe('add / list / login', () => {
  let sb;
  before(() => {
    sb = sandbox();
  });
  after(() => sb.cleanup());

  test('nowe konto to pusty, niezależny katalog w ~/.claudea', () => {
    const r = sb.run(['add', 'work']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Pominięto logowanie/);
    const dir = join(sb.home, '.claudea', 'work');
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(sb.account('work').dir, dir);
  });

  test('--dir pozwala wskazać własny katalog', () => {
    const r = sb.run(['add', 'custom', '--dir', '~/elsewhere/custom']);
    assert.equal(r.code, 0, r.out);
    assert.equal(sb.account('custom').dir, join(sb.home, 'elsewhere', 'custom'));
  });

  test('odrzuca duplikaty, nazwy zarezerwowane i niepoprawne', () => {
    for (const name of ['WORK', 'list', 'import', 'a b', '-x']) {
      const r = sb.run(['add', name, '--no-login']);
      assert.equal(r.code, 1, `${name}: ${r.out}`);
    }
  });

  test('nie tworzy konta w ~/.claude, nad nim ani w katalogu z rejestrem', () => {
    assert.equal(sb.run(['add', 'bad', '--dir', '~/.claude']).code, 1);
    assert.equal(sb.run(['add', 'bad', '--dir', '~/.claude/sub']).code, 1);
    assert.equal(sb.run(['add', 'bad', '--dir', '~']).code, 1);
    assert.equal(sb.run(['add', 'bad', '--dir', '~/.claudea']).code, 1);
  });

  test('nie przejmuje niepustego katalogu', () => {
    mkdirSync(join(sb.home, 'zajety'));
    writeFileSync(join(sb.home, 'zajety', 'plik'), '');
    const r = sb.run(['add', 'zajety', '--dir', '~/zajety']);
    assert.equal(r.code, 1);
    assert.match(r.out, /claudea import/);
  });

  test('list --json pokazuje konta i stan logowania', () => {
    let rows = JSON.parse(sb.run(['list', '--json']).stdout);
    assert.deepEqual(rows.map((r) => r.name), ['work', 'custom'], 'kolejność dodania, nie alfabetyczna');
    assert.equal(rows.find((r) => r.name === 'work').loggedIn, false);

    assert.equal(sb.run(['login', 'work', '--email', 'jan@example.com']).code, 0);
    rows = JSON.parse(sb.run(['list', '--json']).stdout);
    const work = rows.find((r) => r.name === 'work');
    assert.equal(work.loggedIn, true);
    assert.equal(work.email, 'jan@example.com');
    assert.equal(work.subscriptionType, 'pro');
  });

  test('list oznacza konto aktywne w powłoce (także ze „/” na końcu)', () => {
    const rows = JSON.parse(
      sb.run(['list', '--json'], { env: { CLAUDE_CONFIG_DIR: `${join(sb.home, '.claudea', 'work')}/` } }).stdout,
    );
    assert.equal(rows.find((r) => r.active).name, 'work');
  });

  test('list bez kont', () => {
    const empty = sandbox();
    try {
      assert.match(empty.run(['list']).out, /Nie masz jeszcze kont/);
      assert.deepEqual(JSON.parse(empty.run(['list', '--json']).stdout), []);
    } finally {
      empty.cleanup();
    }
  });
});

describe('run', () => {
  let sb;
  before(() => {
    sb = sandbox();
    sb.run(['add', 'work']);
  });
  after(() => sb.cleanup());

  test('ustawia CLAUDE_CONFIG_DIR i przekazuje argumenty bez interpretacji', () => {
    assert.equal(sb.run(['run', 'work', '-c', '--model', 'x']).code, 0);
    assert.equal(sb.run(['work', '--', '-p', 'hi']).code, 0);
    const [first, second] = sb.calls();
    assert.deepEqual(first, { args: ['-c', '--model', 'x'], configDir: join(sb.home, '.claudea', 'work') });
    assert.deepEqual(second.args, ['-p', 'hi']);
  });

  test('nadpisuje CLAUDE_CONFIG_DIR odziedziczone z powłoki', () => {
    sb.run(['run', 'work'], { env: { CLAUDE_CONFIG_DIR: '/tmp/cokolwiek' } });
    assert.equal(sb.calls().at(-1).configDir, join(sb.home, '.claudea', 'work'));
  });

  test('zwraca kod wyjścia claude', () => {
    assert.equal(sb.run(['run', 'work'], { env: { FAKE_CLAUDE_EXIT: '3' } }).code, 3);
  });

  test('nieznane konto to błąd', () => {
    const r = sb.run(['run', 'nope']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Nie ma konta/);
  });

  test('brak claude w PATH daje czytelny błąd', () => {
    const r = sb.run(['run', 'work'], { env: { CLAUDEA_CLAUDE_BIN: 'claude-nie-istnieje' } });
    assert.equal(r.code, 1);
    assert.match(r.out, /Nie znaleziono polecenia/);
  });
});

describe('remove / rename', () => {
  let sb;
  before(() => {
    sb = sandbox();
  });
  after(() => sb.cleanup());

  test('bez --yes i bez terminala odmawia', () => {
    sb.run(['add', 'tmp']);
    const r = sb.run(['remove', 'tmp']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--yes/);
  });

  test('wylogowuje i usuwa katalog konta', () => {
    sb.run(['login', 'tmp']);
    const r = sb.run(['rm', 'tmp', '--yes']);
    assert.equal(r.code, 0, r.out);
    assert.ok(!existsSync(join(sb.home, '.claudea', 'tmp')));
    assert.equal(sb.account('tmp'), undefined);
    assert.deepEqual(sb.calls().at(-1), { args: ['auth', 'logout'], configDir: join(sb.home, '.claudea', 'tmp') });
  });

  test('nie podąża za symlinkami w katalogu konta', () => {
    sb.run(['add', 'links']);
    const outside = join(sb.root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'cenne.txt'), 'x');
    symlinkSync(outside, join(sb.home, '.claudea', 'links', 'link'));
    assert.equal(sb.run(['rm', 'links', '--yes']).code, 0);
    assert.ok(existsSync(join(outside, 'cenne.txt')));
  });

  test('--keep-files tylko wyrejestrowuje', () => {
    sb.run(['add', 'keep']);
    assert.equal(sb.run(['remove', 'keep', '--yes', '--keep-files']).code, 0);
    assert.ok(existsSync(join(sb.home, '.claudea', 'keep')));
    assert.equal(sb.account('keep'), undefined);
  });

  test('rename zmienia tylko nazwę, katalog i pozycja zostają', () => {
    sb.run(['add', 'old']);
    sb.run(['add', 'zz']);
    const before = sb.names();
    const r = sb.run(['rename', 'old', 'nowe']);
    assert.equal(r.code, 0, r.out);
    assert.equal(sb.account('old'), undefined);
    assert.equal(sb.account('nowe').dir, join(sb.home, '.claudea', 'old'));
    assert.deepEqual(sb.names(), before.map((n) => (n === 'old' ? 'nowe' : n)));
  });

  test('rename pozwala zmienić wielkość liter', () => {
    assert.equal(sb.run(['rename', 'nowe', 'Nowe']).code, 0);
    assert.ok(sb.account('Nowe'));
  });
});

describe('import', () => {
  let sb;
  before(() => {
    sb = sandbox();
    // Układ ręczny (gist) — niezależny katalog w ~/.claude-accounts.
    const manual = join(sb.home, '.claude-accounts', 'Firma');
    mkdirSync(manual, { recursive: true });
    writeFileSync(join(manual, '.claude.json'), '{}');
    // Układ z gista bezpośrednio w HOME.
    mkdirSync(join(sb.home, '.claude-account1'));
    writeFileSync(join(sb.home, '.claude-account1', 'settings.json'), '{}');
    // Układ claude-code-accounts — symlinki do ~/.claude, więc NIE jest niezależny.
    const alt = join(sb.home, '.claude-alt');
    mkdirSync(alt);
    writeFileSync(join(alt, '.claude.json'), '{}');
    symlinkSync(join(sb.claudeHome, 'settings.json'), join(alt, 'settings.json'));
    // Katalog, który nie wygląda na konfigurację Claude Code.
    mkdirSync(join(sb.home, '.claude-junk'));
  });
  after(() => sb.cleanup());

  test('bez terminala wypisuje kandydatów, pomijając zależne od ~/.claude', () => {
    const r = sb.run(['import']);
    assert.equal(r.code, 0);
    assert.match(r.out, /Firma/);
    assert.match(r.out, /\.claude-account1 +→ +account1/);
    assert.doesNotMatch(r.out, /alt|junk/);
  });

  test('katalogu z symlinkami do ~/.claude nie da się zaimportować', () => {
    const r = sb.run(['import', join(sb.home, '.claude-alt')]);
    assert.equal(r.code, 1);
    assert.match(r.out, /nie jest niezależny/);
  });

  test('--all importuje wszystkich kandydatów', () => {
    assert.equal(sb.run(['import', '--all']).code, 0);
    assert.deepEqual(sb.names().sort(), ['Firma', 'account1']);
    assert.equal(sb.account('Firma').dir, join(sb.home, '.claude-accounts', 'Firma'));
    assert.match(sb.run(['import']).out, /Nie znaleziono/);
  });

  test('import katalogu z nazwą', () => {
    const dir = join(sb.home, 'inne');
    mkdirSync(dir);
    assert.equal(sb.run(['import', dir, '--name', 'inne-konto']).code, 0);
    assert.equal(sb.account('inne-konto').dir, dir);
    assert.equal(sb.run(['import', dir, '--name', 'drugi']).code, 1, 'ten sam katalog dwa razy');
  });
});

describe('kolejność kont', () => {
  let sb;
  before(() => {
    sb = sandbox();
    for (const name of ['a', 'b', 'c', 'd']) sb.run(['add', name]);
  });
  after(() => sb.cleanup());

  test('domyślnie kolejność dodania, także w list', () => {
    assert.deepEqual(sb.names(), ['a', 'b', 'c', 'd']);
    assert.deepEqual(JSON.parse(sb.run(['list', '--json']).stdout).map((r) => r.name), ['a', 'b', 'c', 'd']);
  });

  test('order przesuwa podane konta na początek, reszta zachowuje kolejność', () => {
    const r = sb.run(['order', 'c', 'A']);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(sb.names(), ['c', 'a', 'b', 'd']);
    assert.match(r.out, /c, a, b, d/);
  });

  test('order bez argumentów (bez terminala) wypisuje kolejność', () => {
    assert.match(sb.run(['order']).stdout, /1\. c\n {2}2\. a/);
  });

  test('order odrzuca nieznane konta i duplikaty, nie zmieniając kolejności', () => {
    assert.equal(sb.run(['order', 'x']).code, 1);
    assert.equal(sb.run(['order', 'a', 'A']).code, 1);
    assert.deepEqual(sb.names(), ['c', 'a', 'b', 'd']);
  });

  test('nowe konto trafia na koniec', () => {
    sb.run(['add', 'e']);
    assert.deepEqual(sb.names(), ['c', 'a', 'b', 'd', 'e']);
  });
});

describe('rejestr w starym formacie (obiekt)', () => {
  test('jest wczytywany i przy zapisie zamieniany na tablicę', () => {
    const sb = sandbox();
    try {
      mkdirSync(join(sb.home, '.claudea', 'stare'), { recursive: true });
      writeFileSync(
        join(sb.home, '.claudea', 'config.json'),
        JSON.stringify({ version: 1, accounts: { stare: { dir: join(sb.home, '.claudea', 'stare'), createdAt: 'x' } } }),
      );
      assert.deepEqual(JSON.parse(sb.run(['list', '--json']).stdout).map((r) => r.name), ['stare']);
      sb.run(['add', 'nowe']);
      assert.ok(Array.isArray(sb.config().accounts));
      assert.deepEqual(sb.names(), ['stare', 'nowe']);
    } finally {
      sb.cleanup();
    }
  });
});

describe('niezależność od ~/.claude', () => {
  test('pełny cykl nie zmienia ~/.claude ani ~/.claude.json', () => {
    const sb = sandbox();
    try {
      const before = { ...snapshot(sb.claudeHome), json: readFileSync(join(sb.home, '.claude.json'), 'utf8') };
      for (const args of [
        ['add', 'a'],
        ['add', 'b'],
        ['login', 'a'],
        ['run', 'a', '-c'],
        ['list'],
        ['rename', 'b', 'c'],
        ['order', 'c', 'a'],
        ['logout', 'a'],
        ['rm', 'a', '--yes'],
        ['rm', 'c', '--yes'],
      ]) {
        assert.equal(sb.run(args).code, 0, args.join(' '));
      }
      const after = { ...snapshot(sb.claudeHome), json: readFileSync(join(sb.home, '.claude.json'), 'utf8') };
      assert.deepEqual(after, before);
      assert.ok(sb.calls().every((call) => call.configDir?.startsWith(join(sb.home, '.claudea'))));
    } finally {
      sb.cleanup();
    }
  });
});

describe('CLI', () => {
  let sb;
  before(() => {
    sb = sandbox();
  });
  after(() => sb.cleanup());

  test('bez terminala i argumentów pokazuje pomoc', () => {
    const r = sb.run([]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /menedżer niezależnych kont Claude Code/);
  });

  test('usunięte polecenia (współdzielenie, integracja z powłoką) są nieznane', () => {
    for (const command of ['sync', 'share', 'shell', 'shell-init', 'env']) {
      assert.equal(sb.run([command]).code, 1, command);
    }
  });

  test('nie dotyka plików startowych powłoki', () => {
    sb.run(['add', 'konto']);
    sb.run(['run', 'konto']);
    assert.ok(!existsSync(join(sb.home, '.zshrc')));
    assert.ok(!existsSync(join(sb.home, '.bash_profile')));
    assert.ok(!existsSync(join(sb.home, '.bashrc')));
  });

  test('nieznana opcja i polecenie to błąd', () => {
    assert.equal(sb.run(['list', '--bogus']).code, 1);
    assert.equal(sb.run(['bogus']).code, 1);
  });

  test('uszkodzony rejestr nie jest nadpisywany', () => {
    mkdirSync(join(sb.home, '.claudea'), { recursive: true });
    writeFileSync(join(sb.home, '.claudea', 'config.json'), '{ zepsute');
    const r = sb.run(['add', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Nie można odczytać/);
    assert.equal(readFileSync(join(sb.home, '.claudea', 'config.json'), 'utf8'), '{ zepsute');
  });
});
