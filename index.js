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
  gray:   "\x1b[90m",
};

const HOOK_MARKER = "guard-env-check";
const hookCommand = `$ex = @('node_modules','.git','dist','build','.next','coverage','vendor','public','static','.cache','out','tmp','temp','target','bin','obj','.venv','venv','__pycache__','logs','frontend','.turbo'); $t = [System.Diagnostics.Stopwatch]::StartNew(); $sep = [IO.Path]::DirectorySeparatorChar; $found = Get-ChildItem -Path . -Filter '.env*' -File -Force -Recurse | Where-Object { $_.Name -ne '.env.example' -and -not ($_.FullName.Split($sep) | Where-Object { $ex -contains $_ }) }; $t.Stop(); $ms = $t.ElapsedMilliseconds; if ($found) { Write-Output "{\\\"continue\\\": false, \\\"stopReason\\\": \\\"REMOVE .ENV FILE FIRST FOR SAFETY (lookup: $($ms)ms)\\\"}" } else { Write-Output "{\\\"continue\\\": true, \\\"systemMessage\\\": \\\"[guard] .env lookup: $($ms)ms — clean\\\"}" }`;

const LOCATIONS = {
  global:  join(homedir(), ".claude", "settings.json"),
  project: join(process.cwd(), ".claude", "settings.json"),
  local:   join(process.cwd(), ".claude", "settings.local.json"),
};

function hasHook(settingsPath) {
  if (!existsSync(settingsPath)) return false;
  try {
    const s = JSON.parse(readFileSync(settingsPath, "utf8"));
    return s.hooks?.UserPromptSubmit?.some(
      (e) => e.hooks?.some((h) => h.command?.includes(HOOK_MARKER))
    ) ?? false;
  } catch {
    return false;
  }
}

function injectHook(settingsPath) {
  mkdirSync(join(settingsPath, ".."), { recursive: true });

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      console.error(`${c.red}guard: could not parse ${settingsPath} — aborting to avoid overwriting your settings.${c.reset}`);
      process.exit(1);
    }
  }

  settings.hooks ??= {};
  settings.hooks.UserPromptSubmit ??= [];
  settings.hooks.UserPromptSubmit.push({
    hooks: [{ type: "command", shell: "powershell", command: `# ${HOOK_MARKER}\n${hookCommand}` }],
  });

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`\n${c.green}✓${c.reset} Hook installed → ${c.dim}${settingsPath}${c.reset}\n`);
}

async function ensureHook() {
  const alreadyInstalled = Object.values(LOCATIONS).some(hasHook);
  if (alreadyInstalled) return;

  const choices = [
    { label: "Global", desc: "applies to all projects", path: "~/.claude/settings.json",            value: "global"  },
    { label: "Project", desc: "shared with team, committed",  path: ".claude/settings.json",         value: "project" },
    { label: "Local",  desc: "this project only, not committed", path: ".claude/settings.local.json", value: "local"   },
  ];

  const INNER = 52;
  const hr = "─".repeat(INNER + 2);
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const row = (content) => {
    const pad = " ".repeat(Math.max(0, INNER - stripAnsi(content).length));
    return `${c.cyan}│${c.reset} ${content}${pad} ${c.cyan}│${c.reset}`;
  };
  const blank = row("");

  console.log(`\n${c.cyan}╭${hr}╮${c.reset}`);
  console.log(row(`${c.bold}guard${c.reset} ${c.dim}· .env safety hook setup${c.reset}`));
  console.log(`${c.cyan}├${hr}┤${c.reset}`);
  console.log(row(`Where should the hook be installed?`));
  console.log(blank);

  choices.forEach((ch, i) => {
    const num   = `${c.yellow}${i + 1}${c.reset}`;
    const label = `${c.bold}${ch.label}${c.reset}`;
    const desc  = `${c.dim}${ch.desc}${c.reset}`;
    const path  = `${c.gray}${ch.path}${c.reset}`;
    console.log(row(` ${num}  ${label} — ${desc}`));
    console.log(row(`    ${path}`));
    if (i < choices.length - 1) console.log(blank);
  });

  console.log(`${c.cyan}╰${hr}╯${c.reset}`);

  const choice = await new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ${c.cyan}›${c.reset} Enter choice (1-3): `, (answer) => {
      rl.close();
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < choices.length) resolve(choices[idx].value);
      else {
        console.error(`\n${c.red}Invalid choice.${c.reset}`);
        process.exit(1);
      }
    });
  });

  injectHook(LOCATIONS[choice]);
}

await ensureHook();

const args = process.argv.slice(2);
const child = spawn("claude", args, { stdio: "inherit", shell: true });

child.on("exit", (code) => process.exit(code ?? 0));
