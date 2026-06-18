import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

// =============================================================================
// workstream-tree.ts — TEO WorkstreamTree (WS-CORE-07)
//
// Manages isolated working directories (worktrees) for concurrent TEO
// workstreams. Implements three backends per ADR-060:
//
//   git     — git worktree add ~/.teo/worktrees/<project-id>/<ws-id>
//   sandbox — copy-on-create into ~/.teo/worktrees/<project-id>/<ws-id>/
//   none    — shared tree + advisory filesystem write lock
//
// NON-INVASIVE DESIGN: ALL state lives under ~/.teo/, NEVER in the user's
// project directory. The `none` backend's lockfile goes to:
//   ~/.teo/locks/<project-id>/<ws-id>.lock
// The base dir (~/.teo) is resolved from os.homedir() (or the injected
// `baseDir` constructor param used by tests) — never a hardcoded path.
//
// BOUNDARY DECISIONS (documented here for downstream callers):
//
//   1. Duplicate allocate(wsId) — throws. Not idempotent.
//      Callers must close() before re-allocating the same wsId.
//      Rationale: silent idempotency masks logic bugs and lock leaks.
//
//   2. close() on a never-allocated wsId — no-op (resolves undefined, no throw).
//      Rationale: best-effort cleanup in error-recovery paths must not cascade.
//
//   3. git backend on a non-git directory — throws GIT_ERROR.
//      Rationale: fail-fast; use `sandbox` backend as the alternative.
//
//   4. wsId sanitization — any wsId containing "..", "/", or "\" is rejected.
//      Rationale: worktree and lockfile paths are derived from wsId; path
//      traversal must be blocked at entry.
//
//   5. none backend: second allocate for a locked wsId throws LOCK_HELD.
//      Rationale: serialization is enforced, not silently queued.
//
//   6. Registry is append-only JSONL under ~/.teo/worktrees/<project-id>/registry.jsonl.
//      Events: "created", "closed". Lines are never rewritten or deleted.
// =============================================================================

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The three isolation backends. */
export type Backend = "git" | "sandbox" | "none";

/**
 * A handle returned by allocate(). Callers use `cwd` as the working directory
 * for the workstream's subprocess or agent.
 */
export interface WorktreeHandle {
  /** The workstream ID (caller-supplied, validated). */
  wsId: string;
  /** The backend that was used to create this worktree. */
  backend: Backend;
  /**
   * The working directory for this workstream.
   * - git:     ~/.teo/worktrees/<project-id>/<ws-id>  (git worktree)
   * - sandbox: ~/.teo/worktrees/<project-id>/<ws-id>  (copy)
   * - none:    <projectDir>  (original project, shared)
   */
  cwd: string;
}

/**
 * A single lifecycle event written to the append-only JSONL registry.
 * Used by list() to expose workstream history.
 */
export interface WorktreeRecord {
  wsId: string;
  projectId: string;
  backend: Backend;
  event: "created" | "closed";
  timestamp: string; // ISO-8601 UTC
  cwd: string;
}

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface WorkstreamTreeOptions {
  /** The project identifier (used as the registry/worktree namespace). */
  projectId: string;
  /**
   * The absolute path to the user's project directory.
   * - `sandbox` backend copies FROM this directory.
   * - `git` backend must run `git worktree` from here.
   * - `none` backend returns this directory as the cwd (shared tree).
   */
  projectDir: string;
  /**
   * Override the base directory (normally os.homedir()).
   * REQUIRED in tests to avoid writing to the real ~/.teo.
   * Example: pass a fs.mkdtempSync() path.
   */
  baseDir?: string;
}

// ---------------------------------------------------------------------------
// Directories used by the tree (all under ~/.teo — never the project dir)
// ---------------------------------------------------------------------------

interface TeoDirs {
  /** ~/.teo/worktrees/<project-id>/ */
  worktreesDir: string;
  /** ~/.teo/locks/<project-id>/ */
  locksDir: string;
  /** ~/.teo/worktrees/<project-id>/registry.jsonl */
  registryPath: string;
}

function buildTeoDirs(baseDir: string, projectId: string): TeoDirs {
  const teoRoot = path.join(baseDir, ".teo");
  const worktreesDir = path.join(teoRoot, "worktrees", projectId);
  const locksDir = path.join(teoRoot, "locks", projectId);
  const registryPath = path.join(worktreesDir, "registry.jsonl");
  return { worktreesDir, locksDir, registryPath };
}

// ---------------------------------------------------------------------------
// wsId validation
// ---------------------------------------------------------------------------

/** Safe characters: alphanumeric, hyphen, underscore. No slashes, no dots-only. */
const SAFE_WS_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * Validates a wsId against path-traversal and empty-string misuse.
 * Throws with "invalid wsId" in the message if rejected.
 */
function assertSafeWsId(wsId: string): void {
  if (
    wsId.length === 0 ||
    wsId.includes("..") ||
    wsId.includes("/") ||
    wsId.includes("\\") ||
    !SAFE_WS_ID_RE.test(wsId)
  ) {
    throw new Error(
      `invalid wsId: "${wsId}". wsId must be alphanumeric with hyphens/underscores, no path separators or dots.`
    );
  }
}

// ---------------------------------------------------------------------------
// Registry helpers (append-only JSONL)
// ---------------------------------------------------------------------------

function appendRegistry(registryPath: string, record: WorktreeRecord): void {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.appendFileSync(registryPath, JSON.stringify(record) + "\n", "utf8");
}

function readRegistry(registryPath: string): WorktreeRecord[] {
  if (!fs.existsSync(registryPath)) return [];
  const content = fs.readFileSync(registryPath, "utf8").trim();
  if (!content) return [];
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WorktreeRecord);
}

// ---------------------------------------------------------------------------
// Backend implementations
// ---------------------------------------------------------------------------

/**
 * `none` backend — shared tree, advisory file lock.
 *
 * The lockfile path: ~/.teo/locks/<project-id>/<ws-id>.lock
 * This is NEVER in the project directory.
 */
function allocateNone(
  wsId: string,
  projectId: string,
  projectDir: string,
  locksDir: string
): WorktreeHandle {
  const lockPath = path.join(locksDir, `${wsId}.lock`);
  fs.mkdirSync(locksDir, { recursive: true });

  if (fs.existsSync(lockPath)) {
    throw new Error(
      `LOCK_HELD: workstream "${wsId}" is already allocated (lock: ${lockPath}). Close it before re-allocating.`
    );
  }

  // Write advisory lock — includes PID and timestamp for debuggability
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ wsId, projectId, pid: process.pid, timestamp: new Date().toISOString() }),
    { flag: "wx" } // exclusive create — throws if already exists (race guard)
  );

  return { wsId, backend: "none", cwd: projectDir };
}

function closeNone(wsId: string, locksDir: string): void {
  const lockPath = path.join(locksDir, `${wsId}.lock`);
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

/**
 * `sandbox` backend — copy-on-create.
 *
 * Copies the project directory into ~/.teo/worktrees/<project-id>/<ws-id>/,
 * skipping `node_modules` and `.git` (and any path listed in .gitignore
 * at the "best-effort" level — currently we skip node_modules/.git by name).
 */

/** Names to skip at any depth when copying the project into a sandbox. */
const SANDBOX_SKIP = new Set(["node_modules", ".git"]);

function copyDirSandbox(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (SANDBOX_SKIP.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSandbox(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(srcPath);
      fs.symlinkSync(linkTarget, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function allocateSandbox(
  wsId: string,
  projectId: string,
  projectDir: string,
  worktreesDir: string
): WorktreeHandle {
  const sandboxDir = path.join(worktreesDir, wsId);

  if (fs.existsSync(sandboxDir)) {
    throw new Error(
      `already allocated: workstream "${wsId}" sandbox already exists at ${sandboxDir}. Close it before re-allocating.`
    );
  }

  copyDirSandbox(projectDir, sandboxDir);
  return { wsId, backend: "sandbox", cwd: sandboxDir };
}

function closeSandbox(wsId: string, worktreesDir: string): void {
  const sandboxDir = path.join(worktreesDir, wsId);
  if (fs.existsSync(sandboxDir)) {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }
}

/**
 * `git` backend — git worktree add.
 *
 * Creates a new git worktree at ~/.teo/worktrees/<project-id>/<ws-id> on
 * branch `teo/ws-<ws-id>`. Requires the projectDir to be a git repository.
 *
 * If the projectDir is NOT a git repo, throws with "GIT_ERROR: not a git repo".
 */
function allocateGit(wsId: string, projectDir: string, worktreesDir: string): WorktreeHandle {
  // Verify the project dir is a git repo
  try {
    execSync("git rev-parse --git-dir", { cwd: projectDir, stdio: "pipe" });
  } catch {
    throw new Error(
      `GIT_ERROR: not a git repo — "${projectDir}" is not a git repository. ` +
        `Run \`git init\` first, or use the \`sandbox\` backend instead.`
    );
  }

  const worktreePath = path.join(worktreesDir, wsId);
  const branchName = `teo/ws-${wsId}`;

  if (fs.existsSync(worktreePath)) {
    throw new Error(
      `already allocated: workstream "${wsId}" git worktree already exists at ${worktreePath}. Close it before re-allocating.`
    );
  }

  fs.mkdirSync(worktreesDir, { recursive: true });

  try {
    execSync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
      cwd: projectDir,
      stdio: "pipe",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`GIT_ERROR: git worktree add failed: ${msg}`, { cause: err });
  }

  return { wsId, backend: "git", cwd: worktreePath };
}

function closeGit(wsId: string, projectDir: string, worktreesDir: string): void {
  const worktreePath = path.join(worktreesDir, wsId);
  if (!fs.existsSync(worktreePath)) return;

  try {
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: projectDir,
      stdio: "pipe",
    });
  } catch {
    // If git worktree remove fails (e.g. repo gone), fall back to fs removal
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// WorkstreamTree — the main class
// ---------------------------------------------------------------------------

/**
 * WorkstreamTree manages isolated working directories for TEO workstreams.
 *
 * ALL state is written under baseDir/.teo/ (defaults to ~/.teo/).
 * The user's project directory is never modified or written to.
 *
 * @example
 * ```ts
 * const tree = new WorkstreamTree({
 *   projectId: "my-project",
 *   projectDir: "/path/to/project",
 * });
 * const handle = await tree.allocate("ws-001", "sandbox");
 * // handle.cwd is an isolated copy; run agents there
 * await tree.close("ws-001");
 * ```
 */
export class WorkstreamTree {
  private readonly projectId: string;
  private readonly projectDir: string;
  private readonly baseDir: string;
  private readonly dirs: TeoDirs;

  constructor(options: WorkstreamTreeOptions) {
    this.projectId = options.projectId;
    this.projectDir = options.projectDir;
    // Default to os.homedir() so all state goes to ~/.teo/ on real machines.
    // Tests override this with a temp dir so they never touch the real ~/.teo.
    this.baseDir = options.baseDir ?? os.homedir();
    this.dirs = buildTeoDirs(this.baseDir, this.projectId);
  }

  /**
   * Allocates an isolated working directory for the given workstream.
   *
   * @param wsId    — Unique workstream identifier. Must be alphanumeric
   *                  with hyphens/underscores; no path separators or "..".
   * @param backend — Isolation strategy: "git" | "sandbox" | "none".
   * @returns A WorktreeHandle with the `cwd` to use for agent execution.
   * @throws If wsId is invalid, already allocated, or git fails.
   */
  allocate(wsId: string, backend: Backend): Promise<WorktreeHandle> {
    // Wrap in Promise constructor so synchronous throws become rejections,
    // allowing callers to use `await allocate(...)` or `.catch(...)` uniformly.
    return new Promise<WorktreeHandle>((resolve, reject) => {
      try {
        assertSafeWsId(wsId);

        let handle: WorktreeHandle;

        switch (backend) {
          case "none":
            handle = allocateNone(wsId, this.projectId, this.projectDir, this.dirs.locksDir);
            break;
          case "sandbox":
            handle = allocateSandbox(wsId, this.projectId, this.projectDir, this.dirs.worktreesDir);
            break;
          case "git":
            handle = allocateGit(wsId, this.projectDir, this.dirs.worktreesDir);
            break;
          default: {
            // TypeScript exhaustiveness check
            const _never: never = backend;
            throw new Error(`Unknown backend: ${String(_never)}`);
          }
        }

        const record: WorktreeRecord = {
          wsId,
          projectId: this.projectId,
          backend,
          event: "created",
          timestamp: new Date().toISOString(),
          cwd: handle.cwd,
        };
        appendRegistry(this.dirs.registryPath, record);

        resolve(handle);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Closes and cleans up a workstream's isolated directory.
   *
   * Best-effort: if the wsId was never allocated, this is a no-op (no throw).
   * Appends a "closed" event to the registry.
   *
   * @param wsId — The workstream ID to close.
   */
  close(wsId: string): Promise<void> {
    // Wrap in Promise constructor so synchronous throws become rejections.
    // close() is best-effort — callers rely on it resolving (not throwing) for
    // unknown wsIds. All error paths here are no-ops that resolve(undefined).
    return new Promise<void>((resolve) => {
      // We don't assertSafeWsId here — close() is best-effort cleanup and
      // an invalid wsId simply won't match anything anyway. We do a mild check
      // to avoid exploiting fs.existsSync with a path traversal in the lockPath.
      // Safe check: if wsId contains path separators, treat as no-op.
      if (!wsId || wsId.includes("/") || wsId.includes("\\") || wsId.includes("..")) {
        resolve();
        return;
      }

      // Determine which backend was used by reading the registry
      const records = readRegistry(this.dirs.registryPath);
      const lastCreated = records.filter((r) => r.wsId === wsId && r.event === "created").at(-1);

      if (!lastCreated) {
        // Never allocated — no-op
        resolve();
        return;
      }

      // Check if already closed
      const closedAfterLastCreate = records
        .filter((r) => r.wsId === wsId && r.event === "closed")
        .some((r) => new Date(r.timestamp) >= new Date(lastCreated.timestamp));

      if (closedAfterLastCreate) {
        // Already closed — no-op
        resolve();
        return;
      }

      switch (lastCreated.backend) {
        case "none":
          closeNone(wsId, this.dirs.locksDir);
          break;
        case "sandbox":
          closeSandbox(wsId, this.dirs.worktreesDir);
          break;
        case "git":
          closeGit(wsId, this.projectDir, this.dirs.worktreesDir);
          break;
      }

      const record: WorktreeRecord = {
        wsId,
        projectId: this.projectId,
        backend: lastCreated.backend,
        event: "closed",
        timestamp: new Date().toISOString(),
        cwd: lastCreated.cwd,
      };
      appendRegistry(this.dirs.registryPath, record);

      resolve();
    });
  }

  /**
   * Returns all registry records for the given project.
   * Records are append-only lifecycle events (created, closed).
   *
   * @param projectId — The project ID to read registry for.
   */
  list(projectId: string): Promise<WorktreeRecord[]> {
    const dirs = buildTeoDirs(this.baseDir, projectId);
    return new Promise<WorktreeRecord[]>((resolve, reject) => {
      try {
        resolve(readRegistry(dirs.registryPath));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
