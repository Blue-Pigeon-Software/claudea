import * as p from '@clack/prompts';
import { c, CliError } from './log.js';
import { tildify } from './paths.js';
import { loadConfig } from './config.js';
import {
  activeAccount,
  createAccount,
  defaultDirFor,
  findImportCandidates,
  getAccounts,
  importAccount,
  removeAccount,
  renameAccount,
  reorderAccounts,
  validateName,
} from './accounts.js';
import { authLogin, authLogout, runClaude, statusAll } from './claude.js';
import { statusSummary, statusText } from './format.js';
import { disableShellIntegration, enableShellIntegration, shellStatus } from './shell.js';
import { menuSelect, sortList, usePolishMessages } from './ui.js';

/** Ctrl+C / Esc w podmenu — wracamy do menu głównego. */
class Back extends Error {}

async function ask(prompt) {
  const value = await prompt;
  if (p.isCancel(value)) throw new Back();
  return value;
}

const yesNo = (opts) => p.confirm({ active: 'Tak', inactive: 'Nie', ...opts });

async function loadState() {
  const config = loadConfig();
  const accounts = getAccounts(config);
  const spin = p.spinner();
  spin.start('Sprawdzam stan kont');
  const statuses = await statusAll(accounts);
  spin.clear();
  return {
    config,
    accounts,
    statuses,
    statusOf: (account) => statuses[accounts.indexOf(account)],
    active: activeAccount(accounts),
    candidates: findImportCandidates(config),
    shell: shellStatus(),
  };
}

/** Pozycje kont: nazwa wyrównana do kolumny + stan logowania; katalog jako podpowiedź. */
function accountOptions(state, accounts, valueOf) {
  const nameWidth = Math.max(...accounts.map((a) => a.name.length));
  return accounts.map((a) => ({
    value: valueOf(a),
    label: `${a.name.padEnd(nameWidth)}  ${statusText(state.statusOf(a))}`,
    hint: tildify(a.dir),
  }));
}

async function pickAccount(state, message, filter = () => true) {
  const choices = state.accounts.filter((a) => filter(state.statusOf(a)));
  if (choices.length === 0) throw new CliError('Brak kont, na których można to zrobić.');
  const name = await ask(
    menuSelect({
      message,
      options: accountOptions(state, choices, (a) => a.name),
      initialValue: choices.includes(state.active) ? state.active.name : undefined,
    }),
  );
  return state.accounts.find((a) => a.name === name);
}

async function loginFlow(account) {
  p.log.step(`Logowanie na konto ${c.bold(account.name)} — dokończ je w przeglądarce.`);
  const code = await authLogin(account);
  if (code === 0) p.log.success('Zalogowano.');
  else p.log.warn(`\`claude auth login\` zakończył się kodem ${code}.`);
}

function launch(account) {
  p.outro(`Uruchamiam claude na koncie ${c.bold(account.name)}`);
  return runClaude(account, []);
}

// ── Akcje menu ──

const ACTIONS = {
  async run(state) {
    return launch(await pickAccount(state, 'Na którym koncie uruchomić Claude Code?'));
  },

  async add(state) {
    const { config } = state;
    const name = (
      await ask(
        p.text({
          message: 'Nazwa konta',
          placeholder: 'np. praca',
          validate: (value) => validateName((value ?? '').trim(), config),
        }),
      )
    ).trim();
    const dir = await ask(
      p.text({
        message: 'Katalog konta',
        initialValue: tildify(defaultDirFor(config, name)),
        validate: (value) => ((value ?? '').trim() ? undefined : 'Podaj ścieżkę.'),
      }),
    );

    const account = createAccount(config, { name, dir: dir.trim() });
    p.log.success(`Utworzono konto ${c.bold(account.name)} w ${tildify(account.dir)}`);
    if (await ask(yesNo({ message: 'Zalogować się teraz?', initialValue: true }))) await loginFlow(account);
  },

  async login(state) {
    const account = await pickAccount(state, 'Które konto zalogować?');
    const status = state.statusOf(account);
    if (status.loggedIn) {
      const again = await ask(
        yesNo({ message: `Konto jest zalogowane (${statusSummary(status)}). Zalogować ponownie?`, initialValue: false }),
      );
      if (!again) return;
    }
    await loginFlow(account);
  },

  async logout(state) {
    const account = await pickAccount(state, 'Które konto wylogować?', (s) => s.loggedIn !== false);
    if (!(await ask(yesNo({ message: `Wylogować ${account.name}? Poświadczenia zostaną usunięte.`, initialValue: false })))) return;
    const code = await authLogout(account);
    if (code === 0) p.log.success(`Wylogowano ${account.name}.`);
    else p.log.warn(`\`claude auth logout\` zakończył się kodem ${code}.`);
  },

  async order(state) {
    const names = await ask(
      sortList({
        message: 'Kolejność kont w menu',
        items: state.accounts.map((a) => ({ value: a.name, label: a.name })),
      }),
    );
    reorderAccounts(state.config, names);
    p.log.success('Zapisano kolejność kont.');
  },

  async rename(state) {
    const account = await pickAccount(state, 'Któremu kontu zmienić nazwę?');
    const newName = (
      await ask(
        p.text({
          message: 'Nowa nazwa',
          initialValue: account.name,
          validate: (value) => {
            const v = (value ?? '').trim();
            if (v === account.name) return 'To ta sama nazwa.';
            return validateName(v, v.toLowerCase() === account.name.toLowerCase() ? null : state.config);
          },
        }),
      )
    ).trim();
    const renamed = renameAccount(state.config, account.name, newName);
    p.log.success(`Zmieniono nazwę na ${c.bold(renamed.name)} (katalog bez zmian).`);
  },

  async remove(state) {
    const account = await pickAccount(state, 'Które konto usunąć?');
    const how = await ask(
      menuSelect({
        message: `Jak usunąć ${account.name}?`,
        options: [
          { value: 'all', label: 'Wyloguj i skasuj katalog', hint: 'znikną ustawienia, historia i projekty tego konta' },
          { value: 'unregister', label: 'Tylko wyrejestruj', hint: 'katalog i logowanie zostają' },
          { value: 'cancel', label: 'Anuluj' },
        ],
      }),
    );
    if (how === 'cancel') return;
    const deleteFiles = how === 'all';
    const sure = await ask(
      yesNo({
        message: deleteFiles ? `Na pewno skasować ${tildify(account.dir)}?` : `Wyrejestrować ${account.name}?`,
        initialValue: false,
      }),
    );
    if (!sure) return;

    const status = state.statusOf(account);
    if (deleteFiles && status.loggedIn !== false && !status.missing) {
      const code = await authLogout(account).catch(() => 1);
      if (code !== 0) p.log.warn('Wylogowanie się nie powiodło — poświadczenia mogły zostać w Keychain.');
    }
    removeAccount(state.config, account.name, { deleteFiles });
    p.log.success(`Usunięto konto ${c.bold(account.name)}.`);
  },

  async import(state) {
    if (state.candidates.length === 0) throw new CliError('Nie znaleziono katalogów do zaimportowania.');
    const dirs = await ask(
      p.multiselect({
        message: 'Które katalogi zaimportować? (spacja zaznacza, Enter zatwierdza)',
        options: state.candidates.map((cand) => ({ value: cand.dir, label: tildify(cand.dir) })),
        initialValues: state.candidates.map((cand) => cand.dir),
        required: false,
        showInstructions: false,
      }),
    );
    for (const dir of dirs) {
      const cand = state.candidates.find((x) => x.dir === dir);
      const name = (
        await ask(
          p.text({
            message: `Nazwa konta dla ${tildify(dir)}`,
            initialValue: cand.suggestedName,
            validate: (value) => validateName((value ?? '').trim(), state.config),
          }),
        )
      ).trim();
      const account = importAccount(state.config, { dir, name });
      p.log.success(`Zaimportowano ${c.bold(account.name)}.`);
    }
  },

  async shell(state) {
    if (state.shell.enabled) {
      const { files, hint } = disableShellIntegration();
      p.log.success(`Wyłączono integrację z powłoką (${files.map(tildify).join(', ')}).`);
      p.log.info(c.dim(hint));
      return;
    }
    const { file, hint } = enableShellIntegration();
    p.log.success(`Włączono: \`claudea\` uruchamia teraz \`npx claudea\` (${tildify(file)}).`);
    p.log.info(c.dim(hint));
  },
};

/** Menu główne: najpierw konta (wybór = uruchomienie), pod separatorem akcje. */
function mainOptions(state) {
  const hasAccounts = state.accounts.length > 0;
  const options = [];
  if (hasAccounts) options.push(...accountOptions(state, state.accounts, (a) => `run:${a.name}`), { separator: true });
  options.push({ value: 'add', label: 'Dodaj konto' });
  if (state.candidates.length > 0) {
    options.push({ value: 'import', label: 'Importuj istniejące katalogi', hint: `znaleziono: ${state.candidates.length}` });
  }
  if (hasAccounts) options.push({ value: 'login', label: 'Zaloguj konto' });
  if (state.statuses.some((s) => s.loggedIn !== false)) options.push({ value: 'logout', label: 'Wyloguj konto' });
  if (state.accounts.length > 1) options.push({ value: 'order', label: 'Zmień kolejność kont' });
  if (hasAccounts) options.push({ value: 'rename', label: 'Zmień nazwę konta' }, { value: 'remove', label: 'Usuń konto' });
  if (state.shell.file) {
    options.push(
      state.shell.enabled
        ? { value: 'shell', label: 'Wyłącz integrację z powłoką', hint: tildify(state.shell.file) }
        : { value: 'shell', label: 'Włącz integrację z powłoką', hint: 'polecenie claudea uruchomi npx claudea' },
    );
  }
  options.push({ value: 'exit', label: 'Wyjście' });
  return options;
}

/** Wykonuje akcję; zwraca kod wyjścia, gdy trzeba zakończyć (np. po uruchomieniu claude). */
async function perform(action, state) {
  try {
    const result = await ACTIONS[action](state);
    return typeof result === 'number' ? result : undefined;
  } catch (err) {
    if (err instanceof Back) {
      p.log.info(c.dim('Anulowano.'));
      return undefined;
    }
    if (err instanceof CliError) {
      p.log.error(err.hint ? `${err.message}\n${c.dim(err.hint)}` : err.message);
      return undefined;
    }
    throw err;
  }
}

/** Menu główne. `only` uruchamia pojedynczą akcję (np. `claudea run` bez nazwy konta). */
export async function interactive({ only } = {}) {
  usePolishMessages();
  p.intro(`${c.bold('claudea')} ${c.dim('— menedżer niezależnych kont Claude Code')}`);

  if (only) {
    const code = await perform(only, await loadState());
    if (code === undefined) p.outro('Gotowe.');
    return code ?? 0;
  }

  for (;;) {
    const state = await loadState();
    const choice = await menuSelect({
      message: state.accounts.length > 0 ? 'Wybierz konto, aby uruchomić Claude Code' : 'Nie masz jeszcze kont — co robimy?',
      options: mainOptions(state),
      escLabel: 'wyjdź',
    });
    if (p.isCancel(choice) || choice === 'exit') {
      p.outro('Do zobaczenia!');
      return 0;
    }
    if (choice.startsWith('run:')) {
      return launch(state.accounts.find((a) => `run:${a.name}` === choice));
    }
    const code = await perform(choice, state);
    if (code !== undefined) return code;
  }
}
