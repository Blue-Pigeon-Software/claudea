import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';
import { CliError } from './log.js';
import { readJson } from './fsutil.js';

export const claudeBin = () => process.env.CLAUDEA_CLAUDE_BIN || 'claude';

/** Środowisko dla claude na danym koncie — zawsze z CLAUDE_CONFIG_DIR, nigdy ~/.claude. */
export const accountEnv = (account, base = process.env) => ({ ...base, CLAUDE_CONFIG_DIR: account.dir });

const notFound = () =>
  new CliError(`Nie znaleziono polecenia „${claudeBin()}”.`, {
    hint: 'Zainstaluj Claude Code (https://docs.claude.com/claude-code) albo ustaw CLAUDEA_CLAUDE_BIN.',
  });

/** Uruchamia claude na koncie z odziedziczonym terminalem. Zwraca kod wyjścia. */
export function runClaude(account, args = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(claudeBin(), args, { stdio: 'inherit', env: accountEnv(account) });

    // Ctrl+C / Ctrl+\ dostaje cała grupa procesów — obsługuje je claude, my tylko czekamy.
    const ignore = () => {};
    const forward = (signal) => child.kill(signal);
    process.on('SIGINT', ignore);
    process.on('SIGQUIT', ignore);
    process.on('SIGTERM', forward);
    process.on('SIGHUP', forward);
    const cleanup = () => {
      process.off('SIGINT', ignore);
      process.off('SIGQUIT', ignore);
      process.off('SIGTERM', forward);
      process.off('SIGHUP', forward);
    };

    child.on('error', (err) => {
      cleanup();
      reject(err.code === 'ENOENT' ? notFound() : err);
    });
    child.on('exit', (code, signal) => {
      cleanup();
      resolvePromise(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1));
    });
  });
}

export const authLogin = (account, { email, sso, console: useConsole } = {}) =>
  runClaude(account, [
    'auth',
    'login',
    ...(email ? ['--email', email] : []),
    ...(sso ? ['--sso'] : []),
    ...(useConsole ? ['--console'] : []),
  ]);

export const authLogout = (account) => runClaude(account, ['auth', 'logout']);

/**
 * Stan logowania z `claude auth status --json` (~0.1 s). Gdy claude jest niedostępny,
 * awaryjnie czyta `oauthAccount` z .claude.json konta (loggedIn = null → „nieznany”).
 */
export function authStatus(account, { timeout = 15000 } = {}) {
  // `claude auth status` tworzy brakujący katalog konfiguracyjny — nie chcemy tego dla usuniętych katalogów.
  if (!existsSync(account.dir)) {
    return Promise.resolve({ source: 'fs', missing: true, loggedIn: false });
  }
  return new Promise((resolvePromise) => {
    execFile(claudeBin(), ['auth', 'status', '--json'], { env: accountEnv(account), timeout }, (err, stdout) => {
      if (err?.code === 'ENOENT') return resolvePromise(localStatus(account, 'brak polecenia claude'));
      try {
        // Przy braku logowania claude kończy się kodem 1, ale i tak wypisuje JSON.
        const json = JSON.parse(stdout);
        resolvePromise({
          source: 'claude',
          loggedIn: Boolean(json.loggedIn),
          email: json.email ?? null,
          orgName: json.orgName ?? null,
          subscriptionType: json.subscriptionType ?? null,
          authMethod: json.authMethod ?? null,
        });
      } catch {
        resolvePromise(localStatus(account, err?.killed ? 'przekroczono czas' : 'nieczytelna odpowiedź claude'));
      }
    });
  });
}

function localStatus(account, note) {
  const oauth = readJson(join(account.dir, '.claude.json'))?.oauthAccount;
  return {
    source: 'local',
    loggedIn: oauth ? null : false,
    email: oauth?.emailAddress ?? null,
    orgName: oauth?.organizationName ?? null,
    subscriptionType: null,
    authMethod: null,
    note,
  };
}

export const statusAll = (accounts) => Promise.all(accounts.map((a) => authStatus(a)));
