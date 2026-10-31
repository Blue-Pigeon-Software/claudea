import { constants } from 'node:os';
import { stripVTControlCharacters, styleText } from 'node:util';
import { Prompt, SelectPrompt, settings, updateSettings, wrapTextWithPrefix } from '@clack/core';
import {
  S_BAR,
  S_BAR_START,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  formatInstructionFooter,
  limitOptions,
  symbol,
  symbolBar,
} from '@clack/prompts';

// Własne prompty na bazie @clack/core: wygląd jak w @clack/prompts, ale z polskimi podpowiedziami,
// sekcjami w menu i listą do zmiany kolejności — oraz pełnoekranowy tryb aplikacji (alternatywny ekran terminala).

export function usePolishMessages() {
  updateSettings({ messages: { cancel: 'Anulowano', error: 'Coś poszło nie tak' } });
}

// ── Ekran aplikacji ──

const ENTER_SCREEN = '\x1b[?1049h';
const LEAVE_SCREEN = '\x1b[?25h\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[H\x1b[2J';
const FATAL_SIGNALS = ['SIGTERM', 'SIGHUP'];

let screenOpen = false;
/** Tekst nad bieżącym promptem: odtwarzany po zmianie rozmiaru okna, a menu odejmuje go od dostępnej wysokości. */
let screenLines = [];

// Zakończenie dopiero w następnym obiegu pętli: `runClaude()` musi zdążyć przekazać sygnał dziecku.
const onFatalSignal = (signal) => {
  closeScreen();
  setImmediate(() => process.exit(128 + constants.signals[signal]));
};

/** Przełącza na alternatywny ekran: po wyjściu terminal wygląda jak przed uruchomieniem, bez śladów w historii. */
export function openScreen() {
  if (screenOpen) return;
  screenOpen = true;
  process.stdout.write(ENTER_SCREEN);
  process.on('exit', closeScreen);
  for (const signal of FATAL_SIGNALS) process.on(signal, onFatalSignal);
}

export function closeScreen() {
  if (!screenOpen) return;
  screenOpen = false;
  screenLines = [];
  process.stdout.write(LEAVE_SCREEN);
  process.off('exit', closeScreen);
  for (const signal of FATAL_SIGNALS) process.off(signal, onFatalSignal);
}

export function clearScreen() {
  process.stdout.write(CLEAR_SCREEN);
  screenLines = [];
}

function printScreen(text) {
  process.stdout.write(`${text}\n`);
  screenLines.push(text);
}

/** Tytuł ekranu: to samo co `p.intro`, ale pamiętane do odtworzenia po zmianie rozmiaru okna. */
export function printTitle(text) {
  printScreen(`${styleText('gray', S_BAR_START)}  ${text}`);
}

/** Komunikat nad promptem: to samo co `p.log.*`, ale pamiętane do odtworzenia po zmianie rozmiaru okna. */
export function printNotice(mark, text) {
  const [first, ...rest] = text.split('\n');
  const bar = styleText('gray', S_BAR);
  printScreen(bar);
  printScreen(`${mark}  ${first}`);
  for (const line of rest) printScreen(`${bar}  ${line}`);
}

/**
 * Uruchamia prompt tak, by po zmianie rozmiaru okna rysował się od zera — terminal nie przeformatowuje alternatywnego
 * ekranu, więc rysowanie różnicowe clacka zostawiałoby śmieci. Czyścimy przed jego `render` (stąd `prependListener`).
 */
async function promptOnScreen(prompt) {
  const repaint = () => {
    process.stdout.write(CLEAR_SCREEN + screenLines.map((line) => `${line}\n`).join(''));
    prompt._prevFrame = '';
  };
  process.stdout.prependListener('resize', repaint);
  try {
    return await prompt.prompt();
  } finally {
    process.stdout.off('resize', repaint);
  }
}

// ── Prompty ──

const key = (k, text) => `${styleText('dim', k)} ${text}`;
const selectHelp = (enterLabel, escLabel) => [key('↑/↓', 'wybór'), key('Enter:', enterLabel), key('Esc:', escLabel)];
const SORT_HELP = [key('Spacja:', 'chwyć/upuść'), key('↑/↓', 'przesuń'), key('Enter:', 'zapisz'), key('Esc:', 'anuluj')];

const S_SECONDARY = '›';
const S_SECONDARY_ACTIVE = '❯';
const SECTION_WIDTH = 32;

function header(prompt, message) {
  const title = wrapTextWithPrefix(prompt.output, message, `${symbolBar(prompt.state)}  `, `${symbol(prompt.state)}  `);
  return `${settings.withGuide ? `${styleText('gray', S_BAR)}\n` : ''}${title}\n`;
}

const doneBar = () => (settings.withGuide ? `${styleText('gray', S_BAR)}  ` : '');
const activeBar = () => (settings.withGuide ? `${styleText('cyan', S_BAR)}  ` : '');

function sectionLine(label) {
  if (!label) return '';
  return `${styleText('dim', '──')} ${styleText('bold', label)} ${styleText('dim', '─'.repeat(Math.max(SECTION_WIDTH - label.length, 2)))}`;
}

/** `strong` — pozycja główna, jasna także bez kursora; `secondary` — ustawienie, z innym znacznikiem i przygaszone. */
function optionLine(option, state) {
  if (option.separator) return sectionLine(option.label);
  const label = option.label ?? String(option.value);
  const plain = stripVTControlCharacters(label).trimEnd();
  switch (state) {
    case 'active': {
      const mark = option.secondary ? styleText('cyan', S_SECONDARY_ACTIVE) : styleText('green', S_RADIO_ACTIVE);
      return `${mark} ${label}${option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''}`;
    }
    case 'selected':
      return styleText('dim', plain);
    case 'cancelled':
      return styleText(['strikethrough', 'dim'], plain);
    default: {
      const mark = styleText('dim', option.secondary ? S_SECONDARY : S_RADIO_INACTIVE);
      return `${mark} ${option.strong ? label : styleText('dim', label)}`;
    }
  }
}

/**
 * Lista wyboru jak `select` z @clack/prompts, ale z polską stopką i sekcjami: pozycja `{ separator: true, label? }`
 * rysuje pusty wiersz albo nagłówek i jest pomijana przez kursor. `enterLabel` pozycji zmienia opis Enter w stopce.
 */
export function menuSelect({ message, options, initialValue, maxItems, escLabel = 'wróć' }) {
  const prepared = options.map((o) => (o.separator ? { ...o, value: Symbol('separator'), disabled: true } : o));
  const prompt = new SelectPrompt({
    options: prepared,
    initialValue,
    render() {
      const top = header(this, message);
      const current = this.options[this.cursor];
      if (this.state === 'submit') return `${top}${doneBar()}${optionLine(current, 'selected')}`;
      if (this.state === 'cancel') {
        return `${top}${doneBar()}${optionLine(current, 'cancelled')}${settings.withGuide ? `\n${styleText('gray', S_BAR)}` : ''}`;
      }
      const bar = activeBar();
      const footer = formatInstructionFooter(selectHelp(current.enterLabel ?? 'zatwierdź', escLabel), settings.withGuide);
      const rows = limitOptions({
        output: this.output,
        cursor: this.cursor,
        options: this.options,
        maxItems,
        columnPadding: bar.length,
        rowPadding: screenLines.length + top.split('\n').length + footer.length + 1,
        style: (option, isActive) => optionLine(option, isActive ? 'active' : 'inactive'),
      });
      return `${top}${bar}${rows.join(`\n${bar}`)}\n${footer.join('\n')}\n`;
    },
  });
  return promptOnScreen(prompt);
}

/** Lista z możliwością przesuwania pozycji: Spacja chwyta/upuszcza, ↑/↓ przesuwa. Zwraca wartości w nowej kolejności. */
class SortPrompt extends Prompt {
  constructor({ items, ...opts }) {
    super(opts, false);
    this.items = [...items];
    this.cursor = 0;
    this.grabbed = false;
    this.value = this.items.map((item) => item.value);
    this.on('cursor', (action) => {
      if (action === 'space') {
        this.grabbed = !this.grabbed;
        return;
      }
      const delta = action === 'up' ? -1 : action === 'down' ? 1 : 0;
      const next = this.cursor + delta;
      if (delta === 0 || next < 0 || next >= this.items.length) return;
      if (this.grabbed) [this.items[this.cursor], this.items[next]] = [this.items[next], this.items[this.cursor]];
      this.cursor = next;
      this.value = this.items.map((item) => item.value);
    });
  }
}

export function sortList({ message, items }) {
  const prompt = new SortPrompt({
    items,
    render() {
      const top = header(this, message);
      const labels = this.items.map((item) => item.label);
      if (this.state === 'submit') return `${top}${doneBar()}${styleText('dim', labels.join(', '))}`;
      if (this.state === 'cancel') {
        return `${top}${doneBar()}${styleText(['strikethrough', 'dim'], labels.join(', '))}${settings.withGuide ? `\n${styleText('gray', S_BAR)}` : ''}`;
      }
      const bar = activeBar();
      const rows = labels.map((label, i) => {
        const text = `${i + 1}. ${label}`;
        if (i !== this.cursor) return `${styleText('dim', S_RADIO_INACTIVE)} ${styleText('dim', text)}`;
        return this.grabbed
          ? `${styleText('cyan', '↕')} ${styleText(['bold', 'cyan'], text)}`
          : `${styleText('green', S_RADIO_ACTIVE)} ${text}`;
      });
      const footer = formatInstructionFooter(SORT_HELP, settings.withGuide);
      return `${top}${bar}${rows.join(`\n${bar}`)}\n${footer.join('\n')}\n`;
    },
  });
  return promptOnScreen(prompt);
}
