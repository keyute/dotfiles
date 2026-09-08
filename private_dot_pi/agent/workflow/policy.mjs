import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, matchesGlob, resolve, sep } from "node:path";
import { homedir } from "node:os";

export const fileTools = ["read", "write", "edit", "grep", "find", "ls"];
export const workerTools = [...fileTools, "bash"];
export const publicToolName = name => workerTools.includes(name) ? `workspace_${name}` : name;
// The parent session's tool set; children get theirs from the roster config.
export const rootTools = [...workerTools.map(publicToolName), "workspace_task", "mcp", "subagent", "bg_wait", "ask_user_question", "submit_plan", "web_search"];

// Sandboxed shell runs without review, as Claude Code (autoAllowBashIfSandboxed)
// and Codex do: the SRT profile is the boundary. The one effect the profile
// cannot judge is a remote mutation through an allowed domain with ambient
// credentials (~/.config/gh and keychain git auth are reachable inside it), so
// those verbs still go to review. Matching is per shell segment and errs
// toward review: a verb anywhere after its program (so `git -C . push`,
// `bash -c "git push"` and `xargs git push` all match), the ssh family in any
// command position, and `gh` unless the segment is one of its read shapes.
// A false positive (`rg ssh …`) costs one classifier call; obfuscation is an
// accepted residual, as with Codex's check.
const REVIEWED = [
  /\bgit\b.*\bpush\b/,
  /\bdocker\b.*\bpush\b/,
  /\b(npm|pnpm|yarn)\b.*\bpublish\b/,
  /\b(curl|wget)\b.*\s(-[a-zA-Z]*[dFTX]|--data|--form|--json|--request|--upload-file|--method|--post-|--body-)/,
  /(^|[\s/'"`])(ssh|scp|sftp|rsync)\s/,
];
const GH_READ = /^gh\s+(?:api\s+(?!(?:.*\s)?(?:-[a-zA-Z]*[XfF]|--method|--field|--raw-field|--input))|(?:(?:pr|issue|repo|run|release|workflow|gist|label|project|cache|search)\s+)?(?:view|list|status|search|diff|checks|browse|download|logs)\b)/;
const PREFIX = /^(?:(?:\w+=\S*|sudo|env|command|exec|nohup|time|xargs)\s+)+/;

// Claude Code's dangerouslyDisableSandbox, keyed on the tool and not the flag
// alone: authorize forwards every tool's args verbatim and the schemas admit
// extra properties, so a flagged read must stay a sandboxed read.
export const unsandboxed = (tool, args) => tool === "bash" && args?.dangerouslyDisableSandbox === true;

export function needsReview(command) {
  return command.replace(/\\\n/g, " ").split(/\|\||&&|[;|&\n]/).some(segment => {
    const text = segment.trim().replace(PREFIX, "");
    return REVIEWED.some(rule => rule.test(text)) || (/\bgh\b/.test(text) && !GH_READ.test(text));
  });
}

export function canonical(path) {
  try { return realpathSync(path); } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonical(parent), path.slice(parent.length));
  }
}

export function expand(path, cwd, home = homedir()) {
  return resolve(cwd, path === "~" ? home : path.replace(/^~\//, `${home}/`));
}

export function inside(path, root) {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function denied(path, patterns) {
  return patterns.some(pattern => {
    for (let part = path; ; part = dirname(part)) {
      if (matchesGlob(part, pattern) || part === pattern) return true;
      if (dirname(part) === part) return false;
    }
  });
}

function canonicalPattern(pattern) {
  const index = pattern.search(/[?*{[]/);
  if (index < 0) return canonical(pattern);
  const boundary = pattern.lastIndexOf(sep, index);
  return join(canonical(pattern.slice(0, boundary) || sep), pattern.slice(boundary + 1));
}

export class Policy {
  constructor(config, cwd, scratch, controlDir) {
    if (config.version !== 1 || !config.models || !config.filesystem || !config.agents || !config.mcp) {
      throw new Error("Invalid managed Pi policy");
    }
    this.config = config;
    this.cwd = canonical(resolve(cwd));
    if (inside(canonical(homedir()), this.cwd)) throw new Error("Start Pi in a project directory, not your home directory or its ancestors");
    this.scratch = canonical(scratch);
    this.mode = "plan";
    this.approval = "auto";
    this.epoch = 0;
    this.transitioning = false;
    this.baseDenyRead = this.resolvePaths([...config.filesystem.denyRead, controlDir], this.cwd);
    this.baseDenyWrite = [...this.baseDenyRead, ...this.resolvePaths([...config.filesystem.denyWrite, join(this.cwd, ".git"), join(this.cwd, ".pi")], this.cwd)];
    this.caches = config.filesystem.allowWrite.map(p => canonical(expand(p, this.cwd)));
    this.roots = new Map();
  }

  resolvePaths(paths, base) {
    return paths.flatMap(p => { const path = expand(p, base); return [path, canonicalPattern(path)]; });
  }

  // The base lists never change; each added root contributes its own
  // re-rooted entries, so removing a root cannot take a base entry with it.
  get denyRead() { return [...this.baseDenyRead, ...[...this.roots.values()].flatMap(deny => deny.read)]; }
  get denyWrite() { return [...this.baseDenyWrite, ...[...this.roots.values()].flatMap(deny => deny.write)]; }

  // /add-dir: a further editable root (Claude Code's added working directory),
  // bounded like cwd — a real directory, never home or one of its ancestors,
  // never a denied path — and carrying the same relative deny entries (`.env`,
  // `.git`, `.pi`) re-rooted there. Reads need nothing: they were never
  // confined to cwd.
  addRoot(input) {
    const root = canonical(expand(input, this.cwd));
    const rejection = this.rootRejection(root);
    if (rejection) throw new Error(rejection);
    const relative = paths => paths.filter(p => !p.startsWith("/") && !p.startsWith("~"));
    const read = this.resolvePaths(relative(this.config.filesystem.denyRead), root);
    const write = [...read, ...this.resolvePaths([...relative(this.config.filesystem.denyWrite), join(root, ".git"), join(root, ".pi")], root)];
    this.roots.set(root, { read, write });
    return root;
  }

  // Why a canonical path cannot become a root; null when it can. Shared with
  // the argument completions so the menu never offers a path addRoot refuses.
  rootRejection(root) {
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return "Directory not found";
    if (inside(canonical(homedir()), root)) return "Your home directory and its ancestors cannot be added";
    if (denied(root, this.denyWrite) || inside(root, this.cwd) || this.roots.has(root)) return "Directory is already in scope or denied by managed policy";
    return null;
  }

  // /add-dir's argument completions. pi hands the whole argument text as the
  // prefix and replaces all of it, so a candidate is the typed directory part
  // verbatim (relative, `~/` and absolute prefixes all round-trip) plus the
  // entry name. A prefix with no separator lists the siblings of cwd: nothing
  // under cwd can be added, so siblings are the only useful starting point.
  addableDirs(prefix) {
    const cut = prefix.lastIndexOf("/") + 1;
    const head = cut ? prefix.slice(0, cut) : "../";
    const base = prefix.slice(cut);
    let entries;
    try { entries = readdirSync(expand(head, this.cwd), { withFileTypes: true }); } catch { return []; }
    return entries
      .map(entry => entry.name)
      .filter(name => name.startsWith(base) && (base.startsWith(".") || !name.startsWith(".")))
      // An entry that cannot be canonicalized (symlink loop, unreadable parent)
      // is skipped rather than thrown: pi fires completion requests unawaited,
      // so a rejection here is an unhandled one that takes the TUI down.
      .filter(name => { try { return !this.rootRejection(canonical(expand(head + name, this.cwd))); } catch { return false; } })
      .sort()
      .map(name => `${head}${name}/`);
  }

  removeRoot(root) {
    if (!this.roots.delete(root)) throw new Error("Directory was not added");
  }

  // The added root's instructions file, read through the read policy so a
  // symlink cannot carry a denied file into the system prompt.
  instructions(root) {
    const lexical = ["AGENTS.md", "CLAUDE.md"].map(name => join(root, name)).find(existsSync);
    if (!lexical) return "";
    const path = this.checkPath(lexical);
    if (!inside(path, root)) throw new Error("Instructions file resolves outside the added directory");
    return readFileSync(path, "utf8");
  }

  role(name) {
    if (name === "root") return { readonly: false, tools: rootTools };
    const role = this.config.agents[name];
    if (!role) throw new Error("Unknown child policy role");
    return role;
  }

  readonly(name) { return this.mode === "plan" || this.role(name).readonly; }

  checkPath(input, write = false, role = "root") {
    if (typeof input !== "string" || !input || input.includes("\0")) throw new Error("Invalid tool path");
    const lexical = expand(input, this.cwd);
    if (denied(lexical, write ? this.denyWrite : this.denyRead)) throw new Error("Path denied by managed policy");
    const path = canonical(lexical);
    if (denied(path, write ? this.denyWrite : this.denyRead)) throw new Error("Resolved path denied by managed policy");
    if (write) {
      if (this.readonly(role)) throw new Error("Writes are disabled in this scope");
      if (![this.cwd, ...this.roots.keys()].some(root => inside(path, root))) throw new Error("File edits must remain inside the workspace");
    }
    return path;
  }

  inspect(role, tool, args = {}) {
    if (this.transitioning) throw new Error("Policy transition in progress");
    if (!this.role(role).tools.includes(publicToolName(tool))) throw new Error("Tool outside the role's capability ceiling");
    if (fileTools.includes(tool)) {
      const write = tool === "write" || tool === "edit";
      this.checkPath(args.path ?? ".", write, role);
      return "allow";
    }
    if (tool === "bash") {
      if (typeof args.command !== "string" || !args.command.trim()) throw new Error("Missing shell command");
      if (unsandboxed(tool, args)) {
        // The profile is a read-only role's only enforcement.
        if (this.role(role).readonly) throw new Error("Unsandboxed shell is unavailable to read-only roles");
        return "review";
      }
      return this.approval === "ask" || needsReview(args.command) ? "review" : "allow";
    }
    return "review";
  }

  inspectMcp(role, server, tool, args = {}) {
    if (this.transitioning) throw new Error("Policy transition in progress");
    if (!this.role(role).tools.includes("mcp")) throw new Error("MCP unavailable to this role");
    const entry = this.config.mcp[server];
    if (!entry || entry.policy.denied_tools.includes(tool)
      || (entry.policy.allowed_tools?.length && !entry.policy.allowed_tools.includes(tool))) throw new Error("MCP tool denied by managed policy");
    const readOnly = entry.policy.readonly_tools?.includes(tool) ?? false;
    if (this.readonly(role) && !readOnly) throw new Error("MCP operation is not approved for read-only scope");
    for (const key of ["relative_path", "path", "file", "filename", "outputPath"]) {
      if (typeof args[key] === "string") this.checkPath(args[key], !readOnly, role);
    }
    return readOnly && entry.policy.auto_approve_tools ? "allow" : "review";
  }

  profile(role) {
    return {
      filesystem: {
        denyRead: this.denyRead,
        allowWrite: [this.scratch, ...this.caches, ...(!this.readonly(role) ? [this.cwd, ...this.roots.keys()] : [])],
        denyWrite: this.denyWrite,
      },
      network: { allowedDomains: this.config.network.allowedDomains, deniedDomains: [] },
      enableWeakerNestedSandbox: false,
    };
  }
}
