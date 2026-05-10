#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

export const HOOK_MARKER = "guard-env-encrypt";

// INIT_CWD is set by npm to the directory where `npm install` was invoked,
// so we always write into the consuming project, not this package's own dir.
const projectRoot = process.env.INIT_CWD ?? process.cwd();
const SETTINGS_PATH = join(projectRoot, ".claude", "settings.local.json");

const c = {
  reset:  "\x1b[0m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  dim:    "\x1b[2m",
};

// Hook commands invoke the JS scripts bundled inside node_modules/guard/.
// Using node directly avoids any shell-specific issues (PowerShell 5 vs 7, etc.).
export const encryptCmd = `# ${HOOK_MARKER}\nnode node_modules/guard/encrypt.js`;
export const decryptCmd = `# guard-env-decrypt\nnode node_modules/guard/decrypt.js`;

const encryptEntry = {
  hooks: [{ type: "command", shell: "powershell", command: encryptCmd }],
};

const decryptEntry = {
  hooks: [{ type: "command", shell: "powershell", command: decryptCmd }],
};

function hookAlreadyPresent(settings) {
  return (
    settings.hooks?.UserPromptSubmit?.some((e) =>
      e.hooks?.some((h) => h.command?.includes(HOOK_MARKER))
    ) ?? false
  );
}

export function install(settingsPath) {
  let settings = {};
  let fileExisted = false;

  if (existsSync(settingsPath)) {
    fileExisted = true;
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      console.error("guard: could not parse settings.local.json — aborting to avoid data loss.");
      process.exit(1);
    }
  } else {
    mkdirSync(join(settingsPath, ".."), { recursive: true });
  }

  if (hookAlreadyPresent(settings)) {
    console.log(`${c.yellow}guard${c.reset}: encryption hook already exists in ${c.dim}${settingsPath}${c.reset}`);
    return "already-exists";
  }

  settings.hooks ??= {};
  settings.hooks.UserPromptSubmit ??= [];
  settings.hooks.Stop ??= [];

  settings.hooks.UserPromptSubmit.push(encryptEntry);
  settings.hooks.Stop.push(decryptEntry);

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  const action = fileExisted ? "updated" : "created";
  console.log(`${c.green}✓${c.reset} guard: encryption hook installed (${action} ${c.dim}${settingsPath}${c.reset})`);
  return action;
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  install(SETTINGS_PATH);
}
