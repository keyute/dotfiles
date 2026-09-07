import { realpathSync } from "node:fs";
import { dirname, join, matchesGlob, resolve, sep } from "node:path";
import { homedir } from "node:os";

export const fileTools = ["read", "write", "edit", "grep", "find", "ls"];
export const workerTools = [...fileTools, "bash"];
export const publicToolName = name => workerTools.includes(name) ? `workspace_${name}` : name;

// Local read-only shell check: the union of Codex's is_safe_command set and
// Claude Code's built-in read-only Bash set. It only decides which commands
// skip the classifier; the sandbox profile stays the boundary. Fails closed:
// substitution, redirection, grouping, comments, escapes and quoted operators
// all fall through to review.
const READ_ONLY_COMMANDS = {
  cat: null, cd: null, diff: null, du: null, echo: null, false: null, grep: null, head: null, ls: null, nl: null, pwd: null, stat: null, tail: null, true: null, wc: null, which: null,
  find: args => !args.some(arg => /^-(exec|execdir|ok|okdir|delete|fls|fprint0?|fprintf)$/.test(arg)),
  rg: args => !args.some(arg => /^(--pre|--hostname-bin|--search-zip)(=|$)|^-[a-zA-Z]*z/.test(arg)),
  git: args => ["branch", "status", "log", "diff", "show"].includes(args[0]),
  sed: args => args.length === 3 && args[0] === "-n" && /^\d+(,\d+)?p$/.test(args[1]),
};
// Only a whole-token quote is removed; a quote inside a token (`--p're=x'`)
// would let bash reassemble a flag the rules never saw, so it fails closed.
const unquote = token => {
  if (!/['"]/.test(token)) return token;
  const whole = /^(['"])([^'"]*)\1$/.exec(token);
  return whole ? whole[2] : undefined;
};

export function isReadOnlyCommand(command) {
  if (typeof command !== "string" || /[`$(){}<>#\\\n]/.test(command)) return false;
  return command.split(/\|\||&&|[;|&]/).every(segment => {
    const raw = segment.trim().split(/\s+/);
    const [word, ...args] = raw.map(unquote);
    if (word === undefined || args.includes(undefined) || !Object.hasOwn(READ_ONLY_COMMANDS, word)) return false;
    const rule = READ_ONLY_COMMANDS[word];
    // Where flags decide, an unquoted glob could expand to a crafted filename
    // such as `--pre=sh`; the flag-free words stay read-only whatever they get.
    const unquotedGlob = raw.slice(1).some(token => !/['"]/.test(token) && /[*?[]/.test(token));
    return rule === null || (!unquotedGlob && rule(args));
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
    this.denyRead = [...config.filesystem.denyRead, controlDir].flatMap(p => {
      const path = expand(p, this.cwd);
      return [path, canonicalPattern(path)];
    });
    this.denyWrite = [...this.denyRead, ...config.filesystem.denyWrite, join(this.cwd, ".git"), join(this.cwd, ".pi")]
      .flatMap(p => { const path = expand(p, this.cwd); return [path, canonicalPattern(path)]; });
    this.caches = config.filesystem.allowWrite.map(p => canonical(expand(p, this.cwd)));
  }

  role(name) {
    if (name === "root") return { readonly: false, tools: [...workerTools.map(publicToolName), "mcp", "subagent", "bg_wait", "ask_user", "submit_plan"] };
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
      if (!inside(path, this.cwd)) throw new Error("File edits must remain inside the workspace");
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
      return isReadOnlyCommand(args.command) ? "allow" : "review";
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
        allowWrite: [this.scratch, ...this.caches, ...(!this.readonly(role) ? [this.cwd] : [])],
        denyWrite: this.denyWrite,
      },
      network: { allowedDomains: this.config.network.allowedDomains, deniedDomains: [] },
      enableWeakerNestedSandbox: false,
    };
  }
}
