import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { c, CliError, fail, info, ok, warn } from './log.js';
import { tildify } from './paths.js';
import { loadConfig } from './config.js';
import {
  activeAccount,
  createAccount,
  findAccount,
  findImportCandidates,
  getAccounts,
  importAccount,
  removeAccount,
  renameAccount,
  reorderAccounts,
} from './accounts.js';
import { authLogin, authLogout, authStatus, runClaude, statusAll } from './claude.js';
import { accountLines } from './format.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `
${c.bold('claudea')} v${VERSION} — menedżer niezależnych kont Claude Code

Każde konto to osobny CLAUDE_CONFIG_DIR w ~/.claudea/<konto>: własne logowanie,
ustawienia, pluginy i historia. Standardowy ~/.claude nie jest używany.

${c.bold('Użycie:')}
  claudea                          menu interaktywne
  claudea <konto> [arg. claude]    uruchom Claude Code na koncie (skrót od \`run\`)

${c.bold('Konta:')}
  list, ls [--json]                lista kont i stan logowania
  add <nazwa>                      nowe konto (w ~/.claudea/<nazwa>)
      --dir <ścieżka>              własny katalog konta
      --no-login                   nie uruchamiaj logowania
      --email <e-mail>             podpowiedz e-mail na stronie logowania
  remove, rm <nazwa>               usuń konto
      -y, --yes                    bez pytania o potwierdzenie
      --keep-files                 tylko wyrejestruj (katalog i logowanie zostają)
      --no-logout                  nie wylogowuj przed usunięciem katalogu
  rename <stara> <nowa>            zmień nazwę (katalog i logowanie zostają)
  order [<konto>…]                 kolejność kont w menu (podane konta trafiają na początek)
  import [<katalog>]               dodaj istniejący katalog konfiguracyjny Claude Code
      --name <nazwa>, --all

${c.bold('Praca z kontem:')}
  run, use <konto> [--] [arg.]     uruchom claude z CLAUDE_CONFIG_DIR konta
  login <konto>                    zaloguj (--email <e-mail>, --sso, --console)
  logout <konto>                   wyloguj (usuwa poświadczenia, np. z Keychain)

${c.bold('Pliki:')} ~/.claudea/config.json (rejestr), ~/.claudea/<konto> (katalogi kont)
`;

const isTerminal = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

function parse(args, options = {}) {
  try {
    return parseArgs({
      args,
      options: { help: { type: 'boolean', short: 'h' }, ...options },
      allowPositionals: true,
      allowNegative: true,
      strict: true,
    });
  } catch (err) {
    if (err.code?.startsWith('ERR_PARSE_ARGS')) throw new CliError(err.message, { hint: 'Zobacz `claudea --help`.' });
    throw err;
  }
}

function required(value, usage) {
  if (!value) throw new CliError(`Użycie: claudea ${usage}`);
  return value;
}

const interactive = async (opts) => (await import('./interactive.js')).interactive(opts);

// ── Polecenia ──

async function cmdList(args) {
  const { values } = parse(args, { json: { type: 'boolean' } });
  const accounts = getAccounts(loadConfig());
  const statuses = await statusAll(accounts);
  const active = activeAccount(accounts);

  if (values.json) {
    const rows = accounts.map((a, i) => {
      const { source, ...status } = statuses[i];
      return { name: a.name, dir: a.dir, active: a === active, exists: existsSync(a.dir), ...status };
    });
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }

  if (accounts.length === 0) {
    info('Nie masz jeszcze kont. Dodaj: `claudea add <nazwa>` albo zaimportuj istniejące: `claudea import`.');
    return 0;
  }
  console.log();
  for (const line of accountLines(accounts, statuses, active)) console.log(`  ${line}`);
  console.log();
  if (active) info(`Ta powłoka używa konta ${c.bold(active.name)} (CLAUDE_CONFIG_DIR).`);
  return 0;
}

async function cmdAdd(args) {
  const { values, positionals } = parse(args, {
    dir: { type: 'string' },
    login: { type: 'boolean', default: true },
    email: { type: 'string' },
  });
  const name = required(positionals[0], 'add <nazwa> [--dir <ścieżka>] [--no-login]');
  const account = createAccount(loadConfig(), { name, dir: values.dir });
  ok(`Utworzono konto ${c.bold(account.name)} w ${tildify(account.dir)}`);
  info(`Uruchamiaj przez menu \`claudea\` albo bezpośrednio: \`claudea ${account.name}\`.`);

  if (!values.login) return 0;
  if (!isTerminal()) {
    info(`Pominięto logowanie (brak terminala). Zaloguj później: \`claudea login ${account.name}\``);
    return 0;
  }
  info('Logowanie — dokończ je w przeglądarce.');
  return authLogin(account, { email: values.email });
}

async function confirmPrompt(message) {
  const p = await import('@clack/prompts');
  const answer = await p.confirm({ message, initialValue: false, active: 'Tak', inactive: 'Nie' });
  return !p.isCancel(answer) && answer === true;
}

async function cmdRemove(args) {
  const { values, positionals } = parse(args, {
    yes: { type: 'boolean', short: 'y' },
    'keep-files': { type: 'boolean' },
    logout: { type: 'boolean', default: true },
  });
  const config = loadConfig();
  const account = findAccount(config, required(positionals[0], 'remove <nazwa> [--yes] [--keep-files]'));
  const deleteFiles = !values['keep-files'];

  if (!values.yes) {
    if (!isTerminal()) throw new CliError('Potwierdź usunięcie flagą --yes.');
    const what = deleteFiles
      ? `wraz z katalogiem ${tildify(account.dir)} (ustawienia, historia i projekty tego konta)`
      : 'tylko z rejestru (katalog i logowanie zostaną)';
    if (!(await confirmPrompt(`Usunąć konto ${account.name} ${what}?`))) {
      info('Anulowano.');
      return 0;
    }
  }

  if (deleteFiles && values.logout && existsSync(account.dir)) {
    const status = await authStatus(account);
    if (status.loggedIn !== false) {
      info('Wylogowuję konto (usuwa poświadczenia)…');
      const code = await authLogout(account).catch((err) => {
        warn(err.message);
        return 1;
      });
      if (code !== 0) warn('Wylogowanie się nie powiodło — poświadczenia mogły zostać w Keychain.');
    }
  }

  removeAccount(config, account.name, { deleteFiles });
  ok(`Usunięto konto ${c.bold(account.name)}${deleteFiles ? '' : ` (katalog ${tildify(account.dir)} został)`}.`);
  return 0;
}

async function cmdRename(args) {
  const { positionals } = parse(args);
  const usage = 'rename <stara> <nowa>';
  const account = renameAccount(loadConfig(), required(positionals[0], usage), required(positionals[1], usage));
  ok(`Zmieniono nazwę na ${c.bold(account.name)} (katalog bez zmian: ${tildify(account.dir)}).`);
  return 0;
}

async function cmdOrder(args) {
  const { positionals } = parse(args);
  const config = loadConfig();
  if (positionals.length > 0) {
    const accounts = reorderAccounts(config, positionals);
    ok(`Nowa kolejność: ${accounts.map((a) => a.name).join(', ')}`);
    return 0;
  }
  if (config.accounts.length === 0) {
    info('Nie masz jeszcze kont.');
    return 0;
  }
  if (isTerminal() && config.accounts.length > 1) return interactive({ only: 'order' });
  getAccounts(config).forEach((a, i) => console.log(`  ${i + 1}. ${a.name}`));
  info('Zmień: `claudea order <konto> [<konto>…]` — podane konta trafią na początek w tej kolejności.');
  return 0;
}

async function cmdRun(args) {
  // Wszystko po nazwie konta trafia do claude bez interpretacji (np. `claudea run praca -c`).
  const [name, ...rest] = args;
  if (!name || name === '-h' || name === '--help') {
    if (!name && isTerminal()) return interactive({ only: 'run' });
    throw new CliError('Użycie: claudea run <konto> [--] [argumenty claude]');
  }
  const account = findAccount(loadConfig(), name);
  return runClaude(account, rest[0] === '--' ? rest.slice(1) : rest);
}

async function cmdLogin(args) {
  const { values, positionals } = parse(args, {
    email: { type: 'string' },
    sso: { type: 'boolean' },
    console: { type: 'boolean' },
  });
  const account = findAccount(loadConfig(), required(positionals[0], 'login <konto> [--email <e-mail>] [--sso]'));
  return authLogin(account, values);
}

async function cmdLogout(args) {
  const { positionals } = parse(args);
  return authLogout(findAccount(loadConfig(), required(positionals[0], 'logout <konto>')));
}

async function cmdImport(args) {
  const { values, positionals } = parse(args, {
    name: { type: 'string' },
    all: { type: 'boolean' },
  });
  const config = loadConfig();
  const report = (account) => ok(`Zaimportowano ${c.bold(account.name)} z ${tildify(account.dir)}`);

  if (positionals[0]) {
    report(importAccount(config, { dir: positionals[0], name: values.name }));
    return 0;
  }

  const candidates = findImportCandidates(config);
  if (candidates.length === 0) {
    info('Nie znaleziono katalogów do zaimportowania (szukam w ~/.claudea, ~/.claude-accounts i ~/.claude-*).');
    return 0;
  }
  if (values.all) {
    for (const cand of candidates) report(importAccount(config, { dir: cand.dir, name: cand.suggestedName }));
    return 0;
  }
  if (isTerminal()) return interactive({ only: 'import' });

  info('Znalezione katalogi:');
  for (const cand of candidates) console.log(`  ${tildify(cand.dir)}  →  ${c.bold(cand.suggestedName)}`);
  info('Zaimportuj: `claudea import <katalog> [--name <nazwa>]` albo wszystkie: `claudea import --all`.');
  return 0;
}

// ── Dispatch ──

const COMMANDS = {
  list: cmdList,
  ls: cmdList,
  add: cmdAdd,
  remove: cmdRemove,
  rm: cmdRemove,
  rename: cmdRename,
  order: cmdOrder,
  run: cmdRun,
  use: cmdRun,
  login: cmdLogin,
  logout: cmdLogout,
  import: cmdImport,
};

async function dispatch(argv) {
  const [command, ...rest] = argv;

  if (!command) {
    if (isTerminal()) return interactive();
    console.log(HELP);
    return 0;
  }
  if (['-h', '--help', 'help'].includes(command)) {
    console.log(HELP);
    return 0;
  }
  if (['-v', '--version', 'version'].includes(command)) {
    console.log(VERSION);
    return 0;
  }
  if (command === 'ui') return interactive();

  const handler = COMMANDS[command];
  if (handler) {
    if (command !== 'run' && command !== 'use' && (rest.includes('-h') || rest.includes('--help'))) {
      console.log(HELP);
      return 0;
    }
    return handler(rest);
  }

  // `claudea <konto> [argumenty claude]`
  if (getAccounts(loadConfig()).some((a) => a.name === command)) return cmdRun(argv);
  throw new CliError(`Nieznane polecenie lub konto „${command}”.`, { hint: 'Zobacz `claudea --help` lub `claudea list`.' });
}

export async function main(argv) {
  try {
    const code = await dispatch(argv);
    process.exitCode = typeof code === 'number' ? code : 0;
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
    fail(err);
    process.exitCode = 1;
  }
}
