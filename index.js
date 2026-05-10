#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  red:    "\x1b[31m",
};

const CONFIG_DIR  = join(homedir(), ".guard");
const CONFIG_PATH = join(CONFIG_DIR, "providers.json");

// ── Box renderer ──────────────────────────────────────────────────────────────

function printBox(title, lines) {
  const INNER = 52;
  const hr = "─".repeat(INNER + 2);
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const row = (content) => {
    const pad = " ".repeat(Math.max(0, INNER - stripAnsi(content).length));
    return `${c.cyan}│${c.reset} ${content}${pad} ${c.cyan}│${c.reset}`;
  };
  console.log(`\n${c.cyan}╭${hr}╮${c.reset}`);
  console.log(row(`${c.bold}guard${c.reset} ${c.dim}·${c.reset} ${title}`));
  console.log(`${c.cyan}├${hr}┤${c.reset}`);
  for (const line of lines) console.log(row(line));
  console.log(`${c.cyan}╰${hr}╯${c.reset}`);
}

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { active: null, providers: {} };
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    console.error(`${c.red}guard: could not parse ${CONFIG_PATH}${c.reset}`);
    process.exit(1);
  }
}

function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function askQuestion(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

// ── Provider subcommands ──────────────────────────────────────────────────────

async function providerAdd() {
  const rl  = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt) => askQuestion(rl, `  ${c.cyan}›${c.reset} ${prompt}: `);

  printBox("add provider", [
    `Enter details for the new provider.`,
    ``,
    `${c.dim}The endpoint must expose an Anthropic-compatible API${c.reset}`,
    `${c.dim}(accepts POST /v1/messages in Anthropic format).${c.reset}`,
  ]);
  console.log();

  const name   = (await ask("Name (e.g. work)")).trim();
  const url    = (await ask("API base URL (e.g. https://api.example.com/v1)")).trim();
  const apiKey = (await ask("API key")).trim();
  const model  = (await ask("Model (optional, press Enter to skip)")).trim();

  rl.close();

  if (!name)   { console.error(`\n${c.red}Name is required.${c.reset}\n`);    process.exit(1); }
  if (!url)    { console.error(`\n${c.red}URL is required.${c.reset}\n`);     process.exit(1); }
  if (!apiKey) { console.error(`\n${c.red}API key is required.${c.reset}\n`); process.exit(1); }
  if (name.includes(" ")) {
    console.error(`\n${c.red}Name must not contain spaces.${c.reset}\n`);
    process.exit(1);
  }

  const config = loadConfig();
  if (config.providers[name]) {
    console.error(`\n${c.red}Provider "${name}" already exists. Remove it first or choose a different name.${c.reset}\n`);
    process.exit(1);
  }

  config.providers[name] = { url, apiKey, ...(model ? { model } : {}) };
  if (!config.active) config.active = name;

  saveConfig(config);
  console.log(`\n${c.green}✓${c.reset} Provider ${c.bold}${name}${c.reset} added.`);
  if (config.active === name) console.log(`${c.dim}  → set as active provider${c.reset}`);
  console.log();
}

async function providerList() {
  const config = loadConfig();
  const names  = Object.keys(config.providers);

  if (names.length === 0) {
    console.log(`\n  ${c.dim}No providers configured. Run ${c.reset}${c.cyan}guard provider add${c.reset}${c.dim}.${c.reset}\n`);
    return;
  }

  const lines = [];
  for (const name of names) {
    const p      = config.providers[name];
    const active = config.active === name;
    const marker = active ? `${c.green}●${c.reset}` : `${c.dim}○${c.reset}`;
    const badge  = active ? ` ${c.green}(active)${c.reset}` : "";
    lines.push(`${marker} ${c.bold}${name}${c.reset}${badge}`);
    lines.push(`  ${c.dim}url:${c.reset}   ${p.url}`);
    if (p.model) lines.push(`  ${c.dim}model:${c.reset} ${p.model}`);
    lines.push(``);
  }
  if (lines.at(-1) === ``) lines.pop();

  printBox("providers", lines);
  console.log();
}

async function providerUse(name) {
  if (!name) {
    console.error(`${c.red}Usage: guard provider use <name>${c.reset}`);
    process.exit(1);
  }
  const config = loadConfig();
  if (!config.providers[name]) {
    console.error(`\n${c.red}Provider "${name}" not found. Run ${c.cyan}guard provider list${c.reset}${c.red} to see available providers.${c.reset}\n`);
    process.exit(1);
  }
  config.active = name;
  saveConfig(config);
  console.log(`\n${c.green}✓${c.reset} Active provider set to ${c.bold}${name}${c.reset}.\n`);
}

async function providerRemove(name) {
  if (!name) {
    console.error(`${c.red}Usage: guard provider remove <name>${c.reset}`);
    process.exit(1);
  }
  const config = loadConfig();
  if (!config.providers[name]) {
    console.error(`\n${c.red}Provider "${name}" not found.${c.reset}\n`);
    process.exit(1);
  }
  delete config.providers[name];
  if (config.active === name) {
    config.active = null;
    console.log(`\n${c.yellow}⚠${c.reset}  Removed active provider — no provider is now active.`);
  }
  saveConfig(config);
  console.log(`\n${c.green}✓${c.reset} Provider ${c.bold}${name}${c.reset} removed.\n`);
}

async function providerCommand(subArgs) {
  const sub = subArgs[0];
  if      (sub === "add")    await providerAdd();
  else if (sub === "list")   await providerList();
  else if (sub === "use")    await providerUse(subArgs[1]);
  else if (sub === "remove") await providerRemove(subArgs[1]);
  else {
    console.log(`\n  ${c.bold}guard provider${c.reset} commands:\n`);
    console.log(`    ${c.cyan}add${c.reset}            add a new provider`);
    console.log(`    ${c.cyan}list${c.reset}           show all configured providers`);
    console.log(`    ${c.cyan}use <name>${c.reset}     switch active provider`);
    console.log(`    ${c.cyan}remove <name>${c.reset}  remove a provider\n`);
  }
  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const TOP_LEVEL_CMDS = new Set(["add", "list", "use", "remove"]);

if (args[0] === "provider") {
  await providerCommand(args.slice(1));
} else if (TOP_LEVEL_CMDS.has(args[0])) {
  await providerCommand(args);
}
// providerCommand always calls process.exit — execution never continues past either branch

console.log(`\n${c.bold}guard${c.reset} ${c.dim}·${c.reset} Keeps your secrets safe by blocking Claude sessions when ${c.yellow}.env${c.reset} files are present.`);
console.log(`${c.dim}Move .env files to a safe place outside the project before starting a session.${c.reset}\n`);

const config   = loadConfig();
const provider = config.active ? config.providers[config.active] : null;

let claudeEnv  = process.env;
let claudeArgs = args;

if (provider) {
  claudeEnv = { ...process.env, ANTHROPIC_API_KEY: provider.apiKey, ANTHROPIC_BASE_URL: provider.url };
  if (provider.model && !args.includes("--model") && !args.includes("-m")) {
    claudeArgs = ["--model", provider.model, ...args];
  }
}

const child = spawn("claude", claudeArgs, { stdio: "inherit", shell: true, env: claudeEnv });
child.on("exit", (code) => process.exit(code ?? 0));
