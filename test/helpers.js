import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../bin/claudea.js', import.meta.url));
export const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.js', import.meta.url));

/**
 * Odizolowane środowisko: tymczasowy HOME z przykładowym ~/.claude (do sprawdzania, że jest nietknięty), atrapa claude,
 * czyste env (bez CLAUDE_CONFIG_DIR / ZDOTDIR użytkownika). Nigdy nie dotyka prawdziwego HOME.
 */
export function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'claudea-test-'));
  const home = join(root, 'home');
  const claudeHome = join(home, '.claude');
  const log = join(root, 'claude-calls.log');

  // Standardowa instalacja Claude Code — claudea ma jej nigdy nie dotykać.
  mkdirSync(join(claudeHome, 'plugins'), { recursive: true });
  mkdirSync(join(claudeHome, 'projects'), { recursive: true });
  writeFileSync(join(claudeHome, 'settings.json'), '{"theme":"dark"}\n');
  writeFileSync(join(claudeHome, 'history.jsonl'), '');
  writeFileSync(join(claudeHome, '.credentials.json'), '{"secret":true}\n');
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'glowne@example.com' } }));

  const run = (args, { env = {}, input } = {}) => {
    const result = spawnSync(process.execPath, [BIN, ...args], {
      encoding: 'utf8',
      input,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        NO_COLOR: '1',
        CLAUDEA_CLAUDE_BIN: FAKE_CLAUDE,
        FAKE_CLAUDE_LOG: log,
        ...env,
      },
    });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr, out: result.stdout + result.stderr };
  };

  const calls = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];

  const config = () => JSON.parse(readFileSync(join(home, '.claudea', 'config.json'), 'utf8'));
  const account = (name) => config().accounts.find((a) => a.name === name);
  const names = () => config().accounts.map((a) => a.name);

  return {
    root,
    home,
    claudeHome,
    run,
    calls,
    config,
    account,
    names,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
