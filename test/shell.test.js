import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.js';

const ZSH = { SHELL: '/bin/zsh' };
const ALIAS = "alias claudea='npx claudea'";

describe('integracja z powłoką', () => {
  let sb;
  let zshrc;
  beforeEach(() => {
    sb = sandbox();
    zshrc = join(sb.home, '.zshrc');
  });
  afterEach(() => sb.cleanup());

  test('jest domyślnie wyłączona i status niczego nie tworzy', () => {
    const r = sb.run(['shell'], { env: ZSH });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /wyłączona/);
    assert.ok(!existsSync(zshrc));
  });

  test('on dopisuje alias do ~/.zshrc, a status to pokazuje', () => {
    const r = sb.run(['shell', 'on'], { env: ZSH });
    assert.equal(r.code, 0, r.out);
    assert.ok(readFileSync(zshrc, 'utf8').includes(ALIAS));
    assert.match(sb.run(['shell', 'status'], { env: ZSH }).out, /włączona \(~\/\.zshrc\)/);
  });

  test('ponowne on niczego nie zmienia', () => {
    sb.run(['shell', 'on'], { env: ZSH });
    const first = readFileSync(zshrc, 'utf8');
    const r = sb.run(['shell', 'on'], { env: ZSH });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /już włączona/);
    assert.equal(readFileSync(zshrc, 'utf8'), first);
  });

  test('off przywraca plik co do bajtu', () => {
    const original = '# moje ustawienia\nexport FOO=1\n';
    writeFileSync(zshrc, original);
    sb.run(['shell', 'on'], { env: ZSH });
    assert.notEqual(readFileSync(zshrc, 'utf8'), original);
    const r = sb.run(['shell', 'off'], { env: ZSH });
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(zshrc, 'utf8'), original);
  });

  test('off zachowuje to, co dopisano za blokiem', () => {
    writeFileSync(zshrc, 'export FOO=1\n');
    sb.run(['shell', 'on'], { env: ZSH });
    writeFileSync(zshrc, `${readFileSync(zshrc, 'utf8')}export BAR=2\n`);
    sb.run(['shell', 'off'], { env: ZSH });
    const text = readFileSync(zshrc, 'utf8');
    assert.ok(text.includes('export FOO=1\n') && text.includes('export BAR=2\n'));
    assert.ok(!text.includes('claudea'));
  });

  test('off bez włączonej integracji nie tworzy plików', () => {
    const r = sb.run(['shell', 'off'], { env: ZSH });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /już wyłączona/);
    assert.ok(!existsSync(zshrc));
  });

  test('off działa też po zmianie domyślnej powłoki', () => {
    sb.run(['shell', 'on'], { env: ZSH });
    const r = sb.run(['shell', 'off'], { env: { SHELL: '/usr/bin/nushell' } });
    assert.equal(r.code, 0, r.out);
    assert.ok(!readFileSync(zshrc, 'utf8').includes(ALIAS));
  });

  test('symlink do pliku startowego zostaje, zmienia się jego cel', () => {
    const real = join(sb.root, 'dotfiles-zshrc');
    writeFileSync(real, 'export FOO=1\n');
    symlinkSync(real, zshrc);
    sb.run(['shell', 'on'], { env: ZSH });
    assert.ok(lstatSync(zshrc).isSymbolicLink());
    assert.ok(readFileSync(real, 'utf8').includes(ALIAS));
    sb.run(['shell', 'off'], { env: ZSH });
    assert.ok(lstatSync(zshrc).isSymbolicLink());
    assert.equal(readFileSync(real, 'utf8'), 'export FOO=1\n');
  });

  test('respektuje ZDOTDIR', () => {
    const zdotdir = join(sb.root, 'zdot');
    mkdirSync(zdotdir);
    sb.run(['shell', 'on'], { env: { ...ZSH, ZDOTDIR: zdotdir } });
    assert.ok(readFileSync(join(zdotdir, '.zshrc'), 'utf8').includes(ALIAS));
    assert.ok(!existsSync(zshrc));
  });

  test('bash i fish mają własne pliki', () => {
    sb.run(['shell', 'on'], { env: { SHELL: '/bin/bash' } });
    const bashrc = join(sb.home, process.platform === 'darwin' ? '.bash_profile' : '.bashrc');
    assert.ok(readFileSync(bashrc, 'utf8').includes(ALIAS));

    sb.run(['shell', 'on'], { env: { SHELL: '/usr/bin/fish' } });
    assert.ok(readFileSync(join(sb.home, '.config', 'fish', 'config.fish'), 'utf8').includes(ALIAS));
    assert.ok(!existsSync(zshrc));
  });

  test('nieobsługiwana powłoka to błąd', () => {
    const r = sb.run(['shell', 'on'], { env: { SHELL: '/usr/bin/nushell' } });
    assert.equal(r.code, 1);
    assert.match(r.out, /Nieobsługiwana powłoka: nushell/);
    assert.equal(sb.run(['shell', 'on']).code, 1);
  });

  test('blok bez znacznika końca nie jest ruszany', () => {
    const broken = 'export FOO=1\n# >>> claudea >>>\nexport BAR=2\n';
    writeFileSync(zshrc, broken);
    const r = sb.run(['shell', 'off'], { env: ZSH });
    assert.equal(r.code, 1);
    assert.match(r.out, /Usuń ten fragment ręcznie/);
    assert.equal(readFileSync(zshrc, 'utf8'), broken);
  });

  test('nieznana akcja to błąd, a „shell” jest nazwą zarezerwowaną', () => {
    assert.equal(sb.run(['shell', 'bogus'], { env: ZSH }).code, 1);
    assert.match(sb.run(['add', 'shell']).out, /zarezerwowana/);
    assert.ok(!existsSync(zshrc));
  });
});
