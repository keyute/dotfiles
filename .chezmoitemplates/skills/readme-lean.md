---
name: readme-lean
description: Review or rewrite a README to be lean, accurate to the current code, and free of AI-telltale prose. Use when asked to write, review, or clean up a README.
---

Produce a README that is lean, verified, and reads like a human maintainer wrote it.

## Steps

1. **Verify before writing.** Read the current README, then check every claim against
   the repo: commands must exist (package.json scripts, Makefile targets, compose
   services, CI workflows), config vars must be real (grep for where they are read),
   setup steps must work from a cold clone. Fix or drop anything you cannot verify;
   never document aspirational behavior.

2. **Keep only what a new contributor needs.**
   - What this is — 1–2 sentences, no marketing prose
   - Quickstart — the shortest verified path to running it
   - Configuration — only vars that exist, with defaults, as a table if >3
   - Development — how to test/lint/build, verified
   - Keep any project-specific sections the maintainer added deliberately
     (architecture notes, deployment runbooks); trim, don't delete.

3. **Remove AI telltales.** No emoji in headings, no "Features 🚀" lists restating the
   code, no "This project provides a robust/comprehensive…" openers, no badge walls,
   no boilerplate Contributing/License sections unless the repo actually has those
   policies, no exhaustive tables of every file. Prefer short paragraphs over nested
   bullet pyramids.

4. **Report.** Note any commands or claims you could not verify and left flagged,
   rather than silently keeping them.
