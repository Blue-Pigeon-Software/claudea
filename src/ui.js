import { styleText } from 'node:util';
import { Prompt, SelectPrompt, settings, updateSettings, wrapTextWithPrefix } from '@clack/core';
import {
  S_BAR,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  formatInstructionFooter,
  limitOptions,
  symbol,
  symbolBar,
} from '@clack/prompts';

// Własne prompty na bazie @clack/core: wygląd jak w @clack/prompts, ale z polskimi podpowiedziami,
// separatorem sekcji w menu i listą do zmiany kolejności.

export function usePolishMessages() {
  updateSettings({ messages: { cancel: 'Anulowano', error: 'Coś poszło nie tak' } });
}

const key = (k, text) => `${styleText('dim', k)} ${text}`;
const selectHelp = (escLabel) => [key('↑/↓', 'wybór'), key('Enter:', 'zatwierdź'), key('Esc:', escLabel)];
const SORT_HELP = [key('Spacja:', 'chwyć/upuść'), key('↑/↓', 'przesuń'), key('Enter:', 'zapisz'), key('Esc:', 'anuluj')];

function header(prompt, message) {
  const title = wrapTextWithPrefix(prompt.output, message, `${symbolBar(prompt.state)}  `, `${symbol(prompt.state)}  `);
  return `${settings.withGuide ? `${styleText('gray', S_BAR)}\n` : ''}${title}\n`;
}

const doneBar = () => (settings.withGuide ? `${styleText('gray', S_BAR)}  ` : '');
const activeBar = () => (settings.withGuide ? `${styleText('cyan', S_BAR)}  ` : '');

function optionLine(option, state) {
  if (option.separator) return styleText('dim', '─'.repeat(24));
  const label = option.label ?? String(option.value);
  switch (state) {
    case 'active':
      return `${styleText('green', S_RADIO_ACTIVE)} ${label}${option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''}`;
    case 'selected':
      return styleText('dim', label);
    case 'cancelled':
      return styleText(['strikethrough', 'dim'], label);
    default:
      return `${styleText('dim', S_RADIO_INACTIVE)} ${styleText('dim', label)}`;
  }
}

/**
 * Lista wyboru jak `select` z @clack/prompts, ale z polską stopką i separatorami:
 * pozycja `{ separator: true }` rysuje linię i jest pomijana przez kursor.
 */
export function menuSelect({ message, options, initialValue, maxItems, escLabel = 'wróć' }) {
  const prepared = options.map((o) => (o.separator ? { ...o, value: Symbol('separator'), disabled: true } : o));
  return new SelectPrompt({
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
      const footer = formatInstructionFooter(selectHelp(escLabel), settings.withGuide);
      const rows = limitOptions({
        output: this.output,
        cursor: this.cursor,
        options: this.options,
        maxItems,
        columnPadding: bar.length,
        rowPadding: top.split('\n').length + footer.length + 1,
        style: (option, isActive) => optionLine(option, isActive ? 'active' : 'inactive'),
      });
      return `${top}${bar}${rows.join(`\n${bar}`)}\n${footer.join('\n')}\n`;
    },
  }).prompt();
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
  return new SortPrompt({
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
  }).prompt();
}
