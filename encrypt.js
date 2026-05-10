#!/usr/bin/env node

import { createCipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KEY_PATH = join(homedir(), ".guard", "crypto.key");

const EXCLUDED = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  "vendor", "public", "static", ".cache", "out", "tmp", "temp",
  "target", "bin", "obj", ".venv", "venv", "__pycache__",
  "logs", "frontend", ".turbo",
]);

function loadOrCreateKey() {
  if (existsSync(KEY_PATH)) {
    return Buffer.from(readFileSync(KEY_PATH, "utf8").trim(), "hex");
  }
  const key = randomBytes(32);
  mkdirSync(join(KEY_PATH, ".."), { recursive: true });
  writeFileSync(KEY_PATH, key.toString("hex"), { mode: 0o600 });
  return key;
}

function collectEnvFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED.has(entry.name)) {
        results.push(...collectEnvFiles(join(dir, entry.name)));
      }
    } else if (
      entry.isFile() &&
      /\.env/.test(entry.name) &&
      !entry.name.endsWith(".enc") &&
      entry.name !== ".env.example"
    ) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

function encryptFile(filePath, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = readFileSync(filePath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Layout: iv (12B) + authTag (16B) + ciphertext
  return Buffer.concat([iv, authTag, ciphertext]);
}

try {
  const files = collectEnvFiles(process.cwd());

  if (files.length === 0) {
    console.log(JSON.stringify({ continue: true, systemMessage: "[guard] no .env files" }));
    process.exit(0);
  }

  const key = loadOrCreateKey();
  const encPaths = [];

  // Pass 1: encrypt all — originals untouched until every .enc is written
  for (const f of files) {
    const encPath = f + ".enc";
    writeFileSync(encPath, encryptFile(f, key));
    encPaths.push(encPath);
  }

  // Pass 2: delete originals only after all .enc files are safely written
  for (const f of files) unlinkSync(f);

  console.log(JSON.stringify({ continue: true, systemMessage: "[guard] .env encrypted" }));
} catch (err) {
  for (const p of encPaths) {
    try { unlinkSync(p); } catch { /* best-effort */ }
  }
  console.log(JSON.stringify({ continue: false, stopReason: `[guard] encrypt failed: ${err.message}` }));
  process.exit(1);
}
