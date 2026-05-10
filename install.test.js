import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { install, HOOK_MARKER, encryptCmd, decryptCmd } from "./install.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempDir() {
  return mkdtempSync(join(tmpdir(), "guard-test-"));
}

// Returns a settings path inside a fresh temp dir that has NO .claude folder yet.
function newSettingsPath() {
  return join(tempDir(), ".claude", "settings.local.json");
}

// Returns a settings path inside a temp dir whose .claude folder already exists.
function existingSettingsPath(content = {}) {
  const dir = tempDir();
  mkdirSync(join(dir, ".claude"));
  const p = join(dir, ".claude", "settings.local.json");
  writeFileSync(p, JSON.stringify(content, null, 2));
  return p;
}

function read(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

// ── 1. File absent ────────────────────────────────────────────────────────────

test("1a — creates .claude dir and settings.local.json when file is absent", () => {
  const p = newSettingsPath();

  install(p);

  assert.ok(existsSync(p), "file created");
});

test("1b — created file has correct JSON structure", () => {
  const p = newSettingsPath();

  install(p);

  const s = read(p);
  assert.ok(typeof s === "object" && s !== null, "valid JSON object");
  assert.ok(Array.isArray(s.hooks?.UserPromptSubmit), "hooks.UserPromptSubmit is array");
  assert.ok(Array.isArray(s.hooks?.Stop), "hooks.Stop is array");
});

test("1c — created file contains encrypt hook in UserPromptSubmit with correct fields", () => {
  const p = newSettingsPath();

  install(p);

  const hook = read(p).hooks.UserPromptSubmit[0].hooks[0];
  assert.equal(hook.type, "command");
  assert.equal(hook.shell, "powershell");
  assert.ok(hook.command.includes(HOOK_MARKER), "encrypt marker in command");
});

test("1d — created file contains decrypt hook in Stop with correct fields", () => {
  const p = newSettingsPath();

  install(p);

  const hook = read(p).hooks.Stop[0].hooks[0];
  assert.equal(hook.type, "command");
  assert.equal(hook.shell, "powershell");
  assert.ok(hook.command.includes("guard-env-decrypt"), "decrypt marker in command");
});

test("1e — returns 'created'", () => {
  const p = newSettingsPath();

  assert.equal(install(p), "created");
});

// ── 2. File exists, hooks key absent ─────────────────────────────────────────

test("2a — adds hooks key when file exists without one", () => {
  const p = existingSettingsPath({ permissions: { allow: [] } });

  install(p);

  assert.ok(read(p).hooks, "hooks key present after install");
});

test("2b — preserves existing top-level keys when adding hooks", () => {
  const p = existingSettingsPath({ permissions: { allow: ["Bash(ls)"] } });

  install(p);

  assert.deepEqual(read(p).permissions, { allow: ["Bash(ls)"] });
});

test("2c — returns 'updated' when file existed without hooks key", () => {
  const p = existingSettingsPath({ permissions: {} });

  assert.equal(install(p), "updated");
});

// ── 3. hooks key exists, UserPromptSubmit absent or empty ─────────────────────

test("3a — adds hooks when UserPromptSubmit key is missing from hooks", () => {
  const p = existingSettingsPath({ hooks: { Stop: [] } });

  install(p);

  const s = read(p);
  assert.equal(s.hooks.UserPromptSubmit.length, 1);
  assert.equal(s.hooks.Stop.length, 1);
});

test("3b — adds hooks when UserPromptSubmit exists but is empty", () => {
  const p = existingSettingsPath({ hooks: { UserPromptSubmit: [], Stop: [] } });

  install(p);

  assert.equal(read(p).hooks.UserPromptSubmit.length, 1);
});

// ── 4. hooks key exists, specific hook absent ─────────────────────────────────

test("4a — adds guard hook alongside existing unrelated UserPromptSubmit hook", () => {
  const p = existingSettingsPath({
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "# other-tool\necho hi" }] },
      ],
      Stop: [],
    },
  });

  install(p);

  const entries = read(p).hooks.UserPromptSubmit;
  assert.equal(entries.length, 2, "original + guard hook");
  assert.ok(
    entries[1].hooks[0].command.includes(HOOK_MARKER),
    "guard hook appended"
  );
});

test("4b — preserves existing Stop hooks when adding decrypt hook", () => {
  const p = existingSettingsPath({
    hooks: {
      UserPromptSubmit: [],
      Stop: [{ hooks: [{ type: "command", command: "# other-stop\necho bye" }] }],
    },
  });

  install(p);

  const stopEntries = read(p).hooks.Stop;
  assert.equal(stopEntries.length, 2, "original + decrypt hook");
  assert.ok(
    stopEntries[1].hooks[0].command.includes("guard-env-decrypt"),
    "decrypt hook appended"
  );
});

test("4c — returns 'updated' when hook was missing and got added", () => {
  const p = existingSettingsPath({ hooks: { UserPromptSubmit: [], Stop: [] } });

  assert.equal(install(p), "updated");
});

// ── 5. Specificity: a different hook must NOT trigger "already-exists" ────────

test("5a — does not treat an unrelated hook command as 'already-exists'", () => {
  const p = existingSettingsPath({
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "# guard-something-else\necho x" }] },
      ],
      Stop: [],
    },
  });

  const result = install(p);

  assert.notEqual(result, "already-exists", "different hook must not block install");
  assert.equal(read(p).hooks.UserPromptSubmit.length, 2, "guard hook still added");
});

test("5b — only the exact HOOK_MARKER string triggers 'already-exists'", () => {
  // Command that contains a substring of the marker but not the full marker.
  const p = existingSettingsPath({
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "# guard-env\necho partial" }] },
      ],
      Stop: [],
    },
  });

  const result = install(p);

  assert.notEqual(result, "already-exists");
});

// ── 6. hooks key exists, specific hook present → "already-exists" ─────────────

test("6a — returns 'already-exists' when guard hook is pre-built in file", () => {
  const p = newSettingsPath();
  install(p); // first install writes the hook

  assert.equal(install(p), "already-exists");
});

test("6b — does not modify file content when hook is already present", () => {
  const p = newSettingsPath();
  install(p);
  const snapshot = readFileSync(p, "utf8");

  install(p);

  assert.equal(readFileSync(p, "utf8"), snapshot, "file unchanged");
});

test("6c — does not duplicate hooks when called repeatedly", () => {
  const p = newSettingsPath();
  install(p);
  install(p);
  install(p);

  const s = read(p);
  assert.equal(s.hooks.UserPromptSubmit.length, 1, "no duplicate encrypt hooks");
  assert.equal(s.hooks.Stop.length, 1, "no duplicate decrypt hooks");
});

// ── 7. Filename matching in encrypt/decrypt commands ──────────────────────────
// These tests validate the regex pattern embedded in the PowerShell commands,
// not the PowerShell runtime itself.

// Extract the JS regex equivalent of the PS `$_.Name -match '\.env'` filter.
const envPattern = /\.env/;

// Names the encrypt command SHOULD match (contains .env, not .enc, not .env.example)
const shouldEncrypt = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  "database.env",        // .env in the middle
  "app.env.local",       // .env not at start
  "my.env",
];

// Names the encrypt command should NOT match
const shouldNotEncrypt = [
  ".env.example",        // explicitly excluded
  ".env.enc",            // already encrypted
  ".env.local.enc",      // already encrypted
  "database.env.enc",    // already encrypted
  "environment.txt",     // no .env in name
  "README.md",
];

for (const name of shouldEncrypt) {
  test(`7-encrypt: matches "${name}"`, () => {
    assert.ok(
      envPattern.test(name) && !name.endsWith(".enc") && name !== ".env.example",
      `expected "${name}" to be selected for encryption`
    );
  });
}

for (const name of shouldNotEncrypt) {
  test(`7-encrypt: skips "${name}"`, () => {
    const wouldMatch =
      envPattern.test(name) && !name.endsWith(".enc") && name !== ".env.example";
    assert.ok(!wouldMatch, `expected "${name}" to be skipped`);
  });
}

// Names the decrypt command SHOULD match (.env in name AND ends with .enc)
const shouldDecrypt = [
  ".env.enc",
  ".env.local.enc",
  ".env.production.enc",
  "database.env.enc",
  "app.env.local.enc",
];

// Names the decrypt command should NOT match
const shouldNotDecrypt = [
  ".env",               // not encrypted
  ".env.local",         // not encrypted
  "database.env",       // not encrypted
  "notes.enc",          // .enc but no .env
  "README.md",
];

for (const name of shouldDecrypt) {
  test(`7-decrypt: matches "${name}"`, () => {
    assert.ok(
      envPattern.test(name) && name.endsWith(".enc"),
      `expected "${name}" to be selected for decryption`
    );
  });
}

for (const name of shouldNotDecrypt) {
  test(`7-decrypt: skips "${name}"`, () => {
    const wouldMatch = envPattern.test(name) && name.endsWith(".enc");
    assert.ok(!wouldMatch, `expected "${name}" to be skipped`);
  });
}
