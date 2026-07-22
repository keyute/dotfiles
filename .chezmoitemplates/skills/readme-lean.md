---
name: readme-lean
description: Review or rewrite a README to be lean, accurate to the current code, and free of AI-telltale prose. Use when asked to write, review, or clean up a README.
---

Produce a README that is lean, verified, and reads like a human maintainer wrote it.

## Steps

1. **Verify before writing.** Read the current README, then check every claim:
   commands must exist (package.json scripts, Makefile targets, compose services,
   CI workflows), config vars must be read somewhere (grep), setup must work from
   a cold clone. Fix or drop what you cannot verify; never document aspirational
   behavior.

2. **Keep only what a new contributor needs.**
   - What this is — 1–2 sentences, no marketing
   - Quickstart — the shortest verified path to running it
   - Configuration — only vars that exist, with defaults; table if >3
   - Development — how to test/lint/build, verified
   - Keep deliberate maintainer sections (architecture notes, runbooks); trim,
     don't delete.

3. **Remove AI telltales.** No emoji in headings, "Features 🚀" lists restating
   the code, "robust/comprehensive" openers, badge walls, boilerplate
   Contributing/License sections without real policies, or exhaustive file
   tables. Short paragraphs over nested bullet pyramids.

4. **Report.** Note any commands or claims left flagged as unverified rather than
   silently kept.
