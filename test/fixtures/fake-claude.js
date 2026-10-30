#!/usr/bin/env node
// Atrapa `claude` do testów: loguje wywołania i emuluje `claude auth *`
// na podstawie `oauthAccount` w .claude.json konta (jak prawdziwy Claude Code).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const configDir = process.env.CLAUDE_CONFIG_DIR;
const stateFile = configDir ? join(configDir, '.claude.json') : join(homedir(), '.claude.json');

if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args, configDir: configDir ?? null })}\n`);
}

const readState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {});
const writeState = (state) => {
  if (configDir) mkdirSync(configDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
};

if (args[0] === 'auth') {
  const state = readState();
  if (args[1] === 'status') {
    const account = state.oauthAccount;
    console.log(
      JSON.stringify({
        loggedIn: Boolean(account),
        authMethod: account ? 'claude.ai' : 'none',
        ...(account && { email: account.emailAddress, orgName: account.organizationName, subscriptionType: 'pro' }),
      }),
    );
    process.exit(account ? 0 : 1);
  }
  if (args[1] === 'login') {
    const email = args.includes('--email') ? args[args.indexOf('--email') + 1] : 'user@example.com';
    writeState({ ...state, oauthAccount: { emailAddress: email, organizationName: 'Org' } });
    process.exit(0);
  }
  if (args[1] === 'logout') {
    delete state.oauthAccount;
    writeState(state);
    process.exit(0);
  }
}

process.exit(Number(process.env.FAKE_CLAUDE_EXIT ?? 0));
