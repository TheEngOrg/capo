/**
 * home — resolves and creates the ~/.teo/ directory tree.
 *
 * TEO owns its own home dir; it never writes run-state into .claude/. This module
 * is the single source of truth for where everything lives. See docs/architecture/TEO-5.md §2.
 *
 *   ~/.teo/
 *     keyring/                 (0700)   signing.key created by the signing module, not here
 *     registry/agents.jsonl
 *     memory/<project-id>/{plans,events,signoffs,streams}/
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface TeoHome {
  /** Absolute path to the ~/.teo root. */
  root: string;
  keyringDir: string;
  signingKeyPath: string;
  registryPath: string;
  memoryDir: string;
}

export interface ProjectPaths {
  plansDir: string;
  eventsDir: string;
  signoffsDir: string;
  streamsDir: string;
  /** Create all four subdirectories (idempotent). */
  ensure: () => void;
}

/** Subset of process.env we read. Injected for testability. */
export interface HomeEnv {
  TEO_HOME?: string;
  HOME?: string;
}

/**
 * Resolve the TEO home location. TEO_HOME wins; otherwise <HOME>/.teo.
 * Pure — creates nothing on disk.
 */
export function resolveTeoHome(env: HomeEnv = process.env): TeoHome {
  let root: string;
  if (env.TEO_HOME && env.TEO_HOME.length > 0) {
    root = env.TEO_HOME;
  } else if (env.HOME && env.HOME.length > 0) {
    root = join(env.HOME, ".teo");
  } else {
    throw new Error("cannot resolve TEO home: neither TEO_HOME nor HOME is set");
  }

  const keyringDir = join(root, "keyring");
  return {
    root,
    keyringDir,
    signingKeyPath: join(keyringDir, "signing.key"),
    registryPath: join(root, "registry", "agents.jsonl"),
    memoryDir: join(root, "memory"),
  };
}

/**
 * Create the TEO home tree if absent. Idempotent.
 * keyring/ is created 0700 — it holds the signing secret. signing.key itself is
 * NOT created here (the signing module generates it on first use).
 */
export function ensureTeoHome(home: TeoHome): void {
  mkdirSync(home.root, { recursive: true });
  mkdirSync(home.keyringDir, { recursive: true, mode: 0o700 });
  // mkdir's mode is masked by umask; enforce 0700 explicitly so the secret dir
  // is never group/world-accessible regardless of the caller's umask.
  chmodSync(home.keyringDir, 0o700);
  mkdirSync(join(home.root, "registry"), { recursive: true });
  mkdirSync(home.memoryDir, { recursive: true });
}

export interface ProjectIdSource {
  /** Git remote URL — preferred seed (stable across clones/paths). */
  gitRemote?: string;
  /** Absolute project path — fallback seed when no remote exists. */
  absPath?: string;
}

/**
 * Stable per-project id used to namespace ~/.teo/memory/<project-id>/.
 * Hashing the seed keeps client paths/remotes out of the on-disk layout while
 * staying deterministic for finance attribution. git remote preferred over path.
 */
export function projectId(src: ProjectIdSource): string {
  const seed = src.gitRemote ?? src.absPath;
  if (!seed || seed.length === 0) {
    throw new Error("projectId requires a gitRemote or absPath");
  }
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

/** Compute the four namespaced subdirs for a project. */
export function projectPaths(home: TeoHome, pid: string): ProjectPaths {
  const base = join(home.memoryDir, pid);
  const plansDir = join(base, "plans");
  const eventsDir = join(base, "events");
  const signoffsDir = join(base, "signoffs");
  const streamsDir = join(base, "streams");
  return {
    plansDir,
    eventsDir,
    signoffsDir,
    streamsDir,
    ensure() {
      mkdirSync(plansDir, { recursive: true });
      mkdirSync(eventsDir, { recursive: true });
      mkdirSync(signoffsDir, { recursive: true });
      mkdirSync(streamsDir, { recursive: true });
    },
  };
}
