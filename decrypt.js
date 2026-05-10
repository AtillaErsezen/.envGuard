#!/usr/bin/env node

import { createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KEY_PATH = join(homedir(), ".guard", "crypto.key");
const EXCLUDED = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  "vendor", "public", "static", ".cache", "out", "tmp", "temp",
  "target", "bin", "obj", ".venv", "venv", "__pycache__",
  "logs", "frontend", ".turbo",
]);

function collectEncFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED.has(entry.name)) {
        results.push(...collectEncFiles(join(dir, entry.name)));
      }
    } else if (
      entry.isFile() &&
      /\.env/.test(entry.name) &&
      entry.name.endsWith(".enc")
    ) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

function decryptFile(encPath, key) {
  const buf = readFileSync(encPath);
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

if (!existsSync(KEY_PATH)) process.exit(0);

const writtenPlaintext = [];

try {
  const key = Buffer.from(readFileSync(KEY_PATH, "utf8").trim(), "hex");
  const files = collectEncFiles(process.cwd());

  if (files.length === 0) process.exit(0);

  // Pass 1: decrypt all — .enc files untouched until every plaintext is written
  for (const f of files) {
    const target = f.replace(/\.enc$/, "");
    writeFileSync(target, decryptFile(f, key));
    writtenPlaintext.push(target);
  }

  // Pass 2: delete .enc files only after all plaintext is safely written
  for (const f of files) unlinkSync(f);
} catch (err) {
  // Clean up any plaintext files written in pass 1, restoring encrypted-only state
  for (const p of writtenPlaintext) {
    try { unlinkSync(p); } catch { /* best-effort */ }
  }
  process.stderr.write(`[guard] decrypt failed: ${err.message}\n`);
  process.exit(1);
}
