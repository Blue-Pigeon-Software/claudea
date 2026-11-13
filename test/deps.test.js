import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const EXACT = /^\d+\.\d+\.\d+$/;

// npx/npm install -g nie używają naszego package-lock.json, więc zakres w rodzaju ^1.8.1 pobiera najnowszą wersję.
// ui.js korzysta z wewnętrznych pomocników clacka (formatInstructionFooter, _prevFrame), których sygnatury
// zmieniają się między wersjami minor — dlatego obie paczki muszą być przypięte dokładnie.
test('zależności @clack są przypięte do dokładnych wersji', () => {
  for (const name of ['@clack/prompts', '@clack/core']) {
    assert.match(pkg.dependencies[name], EXACT, `${name} musi mieć dokładną wersję, jest ${pkg.dependencies[name]}`);
  }
});

test('@clack/core jest w wersji, którą przypina @clack/prompts', () => {
  const prompts = require('@clack/prompts/package.json');
  assert.equal(prompts.version, pkg.dependencies['@clack/prompts']);
  assert.equal(
    prompts.dependencies['@clack/core'],
    pkg.dependencies['@clack/core'],
    'inna wersja core oznacza dwie kopie @clack/core (osobne settings)',
  );
});
