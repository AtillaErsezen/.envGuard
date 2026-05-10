<div align="center">

 ![envguard logo](logo.png)
 
![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)&nbsp;
![platform](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square)

</div>

---

## How it works

```
  you press Enter
       │
       ▼
 ┌─────────────────────────────────────────┐
 │  UserPromptSubmit hook fires            │
 │  .env  ──────────────►  .env.enc        │
 │        AES-256-GCM                      │
 └─────────────────────────────────────────┘
       │
       ▼
  Claude runs — no plaintext secrets in context
       │
       ▼
 ┌─────────────────────────────────────────┐
 │  Stop hook fires                        │
 │  .env.enc  ──────────────►  .env        │
 │            decrypted                    │
 └─────────────────────────────────────────┘
```

Both operations are **atomic** — originals are only deleted after every output file is safely written.

---

## Install

```bash
npm install @atillaersezke/envguard
```

Hooks are registered automatically on install. Nothing else to configure.

---

## Hooks installed

```yaml
# .claude/settings.local.json

hooks:
  UserPromptSubmit:
    - command: node node_modules/@atillaersezke/envguard/encrypt.js
  Stop:
    - command: node node_modules/@atillaersezke/envguard/decrypt.js
```

---

## Encryption

```yaml
algorithm : AES-256-GCM
key       : generated once  →  ~/.guard/crypto.key  (chmod 0600)
wire format:
  - iv        (12 bytes)
  - auth tag  (16 bytes)
  - ciphertext
```

---

## File targeting

```yaml
matches:
  pattern : "**/.env*"
  excludes:
    - "**/.env.example"   # never touched
    - "**/*.enc"          # already encrypted

skipped directories:
  - node_modules, .git
  - dist, build, .next, out
  - .venv, venv, __pycache__
  - coverage, logs, tmp, temp
  - vendor, public, static, .cache
  - target, bin, obj, frontend, .turbo
```

---

## Requirements

- Node.js ≥ 18
- [Claude Code](https://claude.ai/code)
- PowerShell

---

<div align="center">MIT License</div>
