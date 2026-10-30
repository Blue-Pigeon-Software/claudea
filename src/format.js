import { c } from './log.js';
import { tildify } from './paths.js';

/** Stan logowania bez kolorów (np. do podpowiedzi w menu). */
export function statusSummary(status) {
  if (status.missing) return 'brak katalogu';
  if (status.loggedIn === false) return 'niezalogowane';
  const who = [status.email, status.orgName, status.subscriptionType].filter(Boolean).join(' · ');
  if (status.loggedIn === null) return `${who || '?'} (stan nieznany: ${status.note})`;
  return who || 'zalogowane';
}

export function statusText(status) {
  const text = statusSummary(status);
  if (status.missing) return c.red(text);
  if (status.loggedIn === false) return c.yellow(text);
  if (status.loggedIn === null) return c.dim(text);
  return text;
}

function statusDot(status) {
  if (status.missing) return c.red('✗');
  if (status.loggedIn === false) return c.yellow('○');
  if (status.loggedIn === null) return c.dim('●');
  return c.green('●');
}

/** Wiersze tabeli kont: znacznik aktywnego, kropka stanu, nazwa, katalog, logowanie. */
export function accountLines(accounts, statuses, active) {
  const width = (values) => Math.max(...values.map((v) => v.length));
  const nameW = width(accounts.map((a) => a.name));
  const dirW = width(accounts.map((a) => tildify(a.dir)));
  return accounts.map((a, i) =>
    [
      `${a === active ? c.cyan('▸') : ' '} ${statusDot(statuses[i])}`,
      c.bold(a.name.padEnd(nameW)),
      tildify(a.dir).padEnd(dirW),
      statusText(statuses[i]),
    ].join('  '),
  );
}
