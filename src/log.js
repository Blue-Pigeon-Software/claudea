import { styleText } from 'node:util';

/** Błąd „użytkowy” — wypisywany bez stack trace'a, z opcjonalną podpowiedzią. */
export class CliError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = 'CliError';
    this.hint = hint;
  }
}

// styleText sam wyłącza kolory, gdy stdout nie jest TTY albo ustawiono NO_COLOR.
const style = (format) => (text) => styleText(format, String(text));

export const c = {
  bold: style('bold'),
  dim: style('dim'),
  red: style('red'),
  green: style('green'),
  yellow: style('yellow'),
  cyan: style('cyan'),
  magenta: style('magenta'),
};

export function ok(msg) {
  console.log(`${c.green('✓')} ${msg}`);
}

export function info(msg) {
  console.log(`${c.cyan('ℹ')} ${msg}`);
}

export function warn(msg) {
  console.error(`${c.yellow('!')} ${msg}`);
}

export function fail(err) {
  console.error(`${c.red('błąd:')} ${err.message}`);
  if (err.hint) console.error(`  ${c.dim(err.hint)}`);
}
