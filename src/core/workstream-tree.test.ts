import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { WorkstreamTree, type WorktreeRecord } from "./workstream-tree.js";

// =============================================================================
// workstream-tree.test.ts — exhaustive tests for src/core/workstream-tree.ts
//
// Ordering: misuse → boundary → golden path (per ADR-064 critical-path policy)
//
// CRITICAL CONTRACT DECISIONS UNDER TEST:
//   1. Duplicate allocate(wsId) — returns an error (throws); not idempotent.
//      Rationale: silent idempotency masks bugs. Callers should close first.
//   2. close() on a never-allocated wsId — no-op (no throw).
//      Rationale: best-effort cleanup must not block callers on partial failures.
//   3. git backend on a non-git directory — throws a clear error ("not a git repo").
//      Rationale: fail-fast; sandbox backend is the explicit alternative.
//   4. wsId sanitization — any wsId containing ".." or path separators throws.
//      Rationale: lockfile/worktree paths derive from wsId; traversal must be blocked.
//   5. none backend second allocate for same wsId while first is open — throws
//      LOCK_HELD (serialization enforced, not silently queued).
//   6. Lockfile for `none` backend lives under ~/.teo/locks/, NEVER project dir.
//   7. Registry is append-only JSONL: N allocations → exactly N lines.
// =============================================================================

// ---------------------------------------------------------------------------
// Helpers — temp home dir injection
// Tests override the home dir via WorkstreamTree constructor `baseDir` param
// so they never write to the real ~/.teo.
// ---------------------------------------------------------------------------

let tmpHome: string;
let tmpProjectDir: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "teo-test-home-"));
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-test-project-"));

  // Write some project files to use for sandbox copy tests
  fs.writeFileSync(path.join(tmpProjectDir, "index.ts"), "export const x = 1;\n");
  fs.writeFileSync(path.join(tmpProjectDir, "README.md"), "# Test project\n");
  fs.mkdirSync(path.join(tmpProjectDir, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(tmpProjectDir, "node_modules", "dep.js"), "module.exports = {};\n");
  fs.mkdirSync(path.join(tmpProjectDir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(tmpProjectDir, ".git", "HEAD"), "ref: refs/heads/main\n");
});

afterEach(() => {
  // Best-effort cleanup of temp dirs
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpProjectDir, { recursive: true, force: true });
});

function makeTree(projectId = "proj-test"): WorkstreamTree {
  return new WorkstreamTree({ projectId, projectDir: tmpProjectDir, baseDir: tmpHome });
}

// ---------------------------------------------------------------------------
// MISUSE — wsId path traversal injection
// ---------------------------------------------------------------------------

describe("WorkstreamTree — misuse: wsId sanitization", () => {
  it("rejects a wsId containing '..'", async () => {
    const tree = makeTree();
    await expect(tree.allocate("../evil", "none")).rejects.toThrow(/invalid wsId/i);
  });

  it("rejects a wsId containing a forward slash", async () => {
    const tree = makeTree();
    await expect(tree.allocate("ws/nested", "none")).rejects.toThrow(/invalid wsId/i);
  });

  it("rejects a wsId containing a backslash", async () => {
    const tree = makeTree();
    await expect(tree.allocate("ws\\evil", "none")).rejects.toThrow(/invalid wsId/i);
  });

  it("rejects an empty wsId", async () => {
    const tree = makeTree();
    await expect(tree.allocate("", "none")).rejects.toThrow(/invalid wsId/i);
  });

  it("accepts a well-formed wsId with hyphens and alphanumeric chars", async () => {
    const tree = makeTree();
    const handle = await tree.allocate("ws-001-abc", "none");
    expect(handle.wsId).toBe("ws-001-abc");
    await tree.close("ws-001-abc");
  });
});

// ---------------------------------------------------------------------------
// MISUSE — duplicate allocate
// ---------------------------------------------------------------------------

describe("WorkstreamTree — misuse: duplicate allocate", () => {
  it("none backend: second allocate for same wsId throws LOCK_HELD", async () => {
    const tree = makeTree();
    await tree.allocate("ws-dup", "none");
    await expect(tree.allocate("ws-dup", "none")).rejects.toThrow(/LOCK_HELD|already allocated/i);
    await tree.close("ws-dup");
  });

  it("sandbox backend: second allocate for same wsId throws ALREADY_ALLOCATED", async () => {
    const tree = makeTree();
    await tree.allocate("ws-dup-sb", "sandbox");
    await expect(tree.allocate("ws-dup-sb", "sandbox")).rejects.toThrow(/already allocated/i);
    await tree.close("ws-dup-sb");
  });
});

// ---------------------------------------------------------------------------
// MISUSE — close on never-allocated wsId (no crash)
// ---------------------------------------------------------------------------

describe("WorkstreamTree — misuse: close on unknown wsId", () => {
  it("close() on a never-allocated wsId does not throw", async () => {
    const tree = makeTree();
    await expect(tree.close("ws-never-existed")).resolves.toBeUndefined();
  });

  it("close() on an already-closed wsId does not throw", async () => {
    const tree = makeTree();
    await tree.allocate("ws-close-twice", "none");
    await tree.close("ws-close-twice");
    await expect(tree.close("ws-close-twice")).resolves.toBeUndefined();
  });

  it("close() with a wsId containing path separators is a no-op (not a throw)", async () => {
    // This exercises the safety guard inside close() — invalid wsIds are
    // silently ignored rather than thrown, because close() is best-effort.
    const tree = makeTree();
    await expect(tree.close("../../evil")).resolves.toBeUndefined();
    await expect(tree.close("ws/nested")).resolves.toBeUndefined();
    await expect(tree.close("ws\\evil")).resolves.toBeUndefined();
  });

  it("close() with an empty wsId is a no-op", async () => {
    const tree = makeTree();
    await expect(tree.close("")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — none backend: lockfile location
// ---------------------------------------------------------------------------

describe("WorkstreamTree — boundary: none backend lockfile location", () => {
  it("lockfile is created under the temp ~/.teo/locks/, NOT under the project dir", async () => {
    const tree = makeTree("proj-lock-test");
    await tree.allocate("ws-locktest", "none");

    // Assert lockfile IS under baseDir/locks/
    const lockPath = path.join(tmpHome, ".teo", "locks", "proj-lock-test", "ws-locktest.lock");
    expect(fs.existsSync(lockPath)).toBe(true);

    // Assert lockfile is NOT under the project dir
    const projectFiles = getAllFilesRecursive(tmpProjectDir);
    const lockFilesInProject = projectFiles.filter((f) => f.endsWith(".lock"));
    expect(lockFilesInProject).toHaveLength(0);

    await tree.close("ws-locktest");
  });

  it("lockfile is removed after close()", async () => {
    const tree = makeTree("proj-cleanup");
    await tree.allocate("ws-cleanup", "none");
    const lockPath = path.join(tmpHome, ".teo", "locks", "proj-cleanup", "ws-cleanup.lock");
    expect(fs.existsSync(lockPath)).toBe(true);
    await tree.close("ws-cleanup");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("none backend: second allocate while first lock is held returns LOCK_HELD error", async () => {
    const tree = makeTree("proj-serialization");
    // Allocate ws-A, which acquires its lock
    await tree.allocate("ws-A", "none");

    // Try again for the same wsId — should fail because the lock is held
    await expect(tree.allocate("ws-A", "none")).rejects.toThrow(/LOCK_HELD|already allocated/i);

    await tree.close("ws-A");
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — sandbox backend: copy isolation
// ---------------------------------------------------------------------------

describe("WorkstreamTree — boundary: sandbox backend", () => {
  it("sandbox copy contains project source files", async () => {
    const tree = makeTree("proj-sb");
    const handle = await tree.allocate("ws-sb-copy", "sandbox");

    const sbIndex = path.join(handle.cwd, "index.ts");
    expect(fs.existsSync(sbIndex)).toBe(true);
    expect(fs.readFileSync(sbIndex, "utf8")).toBe("export const x = 1;\n");

    await tree.close("ws-sb-copy");
  });

  it("sandbox: modifying a file in the sandbox does NOT affect the original project", async () => {
    const tree = makeTree("proj-sb-isolation");
    const handle = await tree.allocate("ws-sb-isolate", "sandbox");

    const sbFile = path.join(handle.cwd, "index.ts");
    fs.writeFileSync(sbFile, "export const x = 999;\n");

    const originalFile = path.join(tmpProjectDir, "index.ts");
    expect(fs.readFileSync(originalFile, "utf8")).toBe("export const x = 1;\n");

    await tree.close("ws-sb-isolate");
  });

  it("sandbox: node_modules is NOT copied into the sandbox", async () => {
    const tree = makeTree("proj-sb-nodemod");
    const handle = await tree.allocate("ws-sb-nodemod", "sandbox");

    const sbNodeModules = path.join(handle.cwd, "node_modules");
    expect(fs.existsSync(sbNodeModules)).toBe(false);

    await tree.close("ws-sb-nodemod");
  });

  it("sandbox: .git directory is NOT copied into the sandbox", async () => {
    const tree = makeTree("proj-sb-git");
    const handle = await tree.allocate("ws-sb-git", "sandbox");

    const sbGit = path.join(handle.cwd, ".git");
    expect(fs.existsSync(sbGit)).toBe(false);

    await tree.close("ws-sb-git");
  });

  it("sandbox: subdirectories (other than node_modules/.git) are recursively copied", async () => {
    // Create a subdirectory with a file in it
    fs.mkdirSync(path.join(tmpProjectDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, "src", "util.ts"), "export const y = 2;\n");

    const tree = makeTree("proj-sb-subdir");
    const handle = await tree.allocate("ws-sb-subdir", "sandbox");

    const sbUtil = path.join(handle.cwd, "src", "util.ts");
    expect(fs.existsSync(sbUtil)).toBe(true);
    expect(fs.readFileSync(sbUtil, "utf8")).toBe("export const y = 2;\n");

    await tree.close("ws-sb-subdir");
  });

  it("sandbox: symlinks in the project are preserved as symlinks in the sandbox", async () => {
    // Create a symlink in the project dir to test the symlink copy path
    const target = path.join(tmpProjectDir, "index.ts");
    const symlinkPath = path.join(tmpProjectDir, "alias.ts");
    fs.symlinkSync(target, symlinkPath);

    const tree = makeTree("proj-sb-symlink");
    const handle = await tree.allocate("ws-sb-symlink", "sandbox");

    const sbSymlink = path.join(handle.cwd, "alias.ts");
    expect(fs.existsSync(sbSymlink)).toBe(true);
    expect(fs.lstatSync(sbSymlink).isSymbolicLink()).toBe(true);

    await tree.close("ws-sb-symlink");
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — registry: append-only JSONL
// ---------------------------------------------------------------------------

describe("WorkstreamTree — boundary: registry JSONL", () => {
  it("N allocations produce exactly N 'created' lines in the registry", async () => {
    const tree = makeTree("proj-registry");

    await tree.allocate("ws-r1", "none");
    await tree.allocate("ws-r2", "none");
    await tree.allocate("ws-r3", "none");

    const registryPath = path.join(tmpHome, ".teo", "worktrees", "proj-registry", "registry.jsonl");
    expect(fs.existsSync(registryPath)).toBe(true);

    const lines = fs.readFileSync(registryPath, "utf8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3);

    const createdLines = lines.filter((l) => {
      const rec = JSON.parse(l) as WorktreeRecord;
      return rec.event === "created";
    });
    expect(createdLines).toHaveLength(3);

    await tree.close("ws-r1");
    await tree.close("ws-r2");
    await tree.close("ws-r3");
  });

  it("close() appends a 'closed' event to the registry", async () => {
    const tree = makeTree("proj-registry-close");

    await tree.allocate("ws-rc", "none");
    await tree.close("ws-rc");

    const registryPath = path.join(
      tmpHome,
      ".teo",
      "worktrees",
      "proj-registry-close",
      "registry.jsonl"
    );
    const lines = fs.readFileSync(registryPath, "utf8").trim().split("\n").filter(Boolean);
    const events = lines.map((l) => (JSON.parse(l) as WorktreeRecord).event);
    expect(events).toContain("created");
    expect(events).toContain("closed");
  });

  it("registry entries are valid JSON with required fields", async () => {
    const tree = makeTree("proj-registry-schema");
    await tree.allocate("ws-schema", "none");

    const registryPath = path.join(
      tmpHome,
      ".teo",
      "worktrees",
      "proj-registry-schema",
      "registry.jsonl"
    );
    const line = fs.readFileSync(registryPath, "utf8").trim().split("\n")[0]!;
    const record = JSON.parse(line) as WorktreeRecord;

    expect(record.wsId).toBe("ws-schema");
    expect(record.projectId).toBe("proj-registry-schema");
    expect(record.event).toBe("created");
    expect(record.backend).toBe("none");
    expect(typeof record.timestamp).toBe("string");

    await tree.close("ws-schema");
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — list()
// ---------------------------------------------------------------------------

describe("WorkstreamTree — boundary: list()", () => {
  it("list() returns an empty array for a project with no allocations", async () => {
    const tree = makeTree("proj-empty");
    const records = await tree.list("proj-empty");
    expect(records).toEqual([]);
  });

  it("list() returns all events for a project (created + closed)", async () => {
    const tree = makeTree("proj-list");
    await tree.allocate("ws-list1", "none");
    await tree.close("ws-list1");

    const records = await tree.list("proj-list");
    expect(records.length).toBeGreaterThanOrEqual(2);
    const events = records.map((r) => r.event);
    expect(events).toContain("created");
    expect(events).toContain("closed");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — none backend
// ---------------------------------------------------------------------------

describe("WorkstreamTree — golden path: none backend", () => {
  it("allocate() returns a WorktreeHandle with correct shape", async () => {
    const tree = makeTree();
    const handle = await tree.allocate("ws-golden-none", "none");

    expect(handle.wsId).toBe("ws-golden-none");
    expect(handle.backend).toBe("none");
    expect(typeof handle.cwd).toBe("string");
    expect(handle.cwd).toBe(tmpProjectDir); // none backend: shared project dir

    await tree.close("ws-golden-none");
  });

  it("none backend: cwd is the project dir (shared tree)", async () => {
    const tree = makeTree("proj-none-cwd");
    const handle = await tree.allocate("ws-cwd", "none");
    expect(handle.cwd).toBe(tmpProjectDir);
    await tree.close("ws-cwd");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — sandbox backend
// ---------------------------------------------------------------------------

describe("WorkstreamTree — golden path: sandbox backend", () => {
  it("allocate() returns a WorktreeHandle with cwd under ~/.teo/worktrees/", async () => {
    const tree = makeTree("proj-sb-golden");
    const handle = await tree.allocate("ws-sb-golden", "sandbox");

    expect(handle.wsId).toBe("ws-sb-golden");
    expect(handle.backend).toBe("sandbox");
    expect(handle.cwd).toContain(path.join(tmpHome, ".teo", "worktrees"));
    expect(fs.existsSync(handle.cwd)).toBe(true);

    await tree.close("ws-sb-golden");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — git backend (integration, gated with skipIf)
// ---------------------------------------------------------------------------

function hasGit(): boolean {
  try {
    const { execSync } = await_require_execSync();
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Lazy-load execSync to keep it out of the static import graph.
// The git tests require a real git repo, so they create one in tmpProjectDir.
function await_require_execSync(): { execSync: typeof import("child_process").execSync } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:child_process") as { execSync: typeof import("child_process").execSync };
}

describe.skipIf(!hasGit())("WorkstreamTree — git backend (integration)", () => {
  let gitProjectDir: string;
  let gitTree: WorkstreamTree;

  beforeEach(() => {
    gitProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-git-proj-"));
    const { execSync } = await_require_execSync();

    // Set up a real git repo (bare minimum for worktree add)
    execSync("git init", { cwd: gitProjectDir, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', { cwd: gitProjectDir, stdio: "ignore" });
    execSync('git config user.name "Test"', { cwd: gitProjectDir, stdio: "ignore" });
    fs.writeFileSync(path.join(gitProjectDir, "init.txt"), "init");
    execSync("git add .", { cwd: gitProjectDir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: gitProjectDir, stdio: "ignore" });

    gitTree = new WorkstreamTree({
      projectId: "proj-git-test",
      projectDir: gitProjectDir,
      baseDir: tmpHome,
    });
  });

  afterEach(() => {
    fs.rmSync(gitProjectDir, { recursive: true, force: true });
  });

  it("git backend: allocate() creates a worktree and returns a cwd under ~/.teo/worktrees/", async () => {
    const handle = await gitTree.allocate("ws-git-01", "git");
    expect(handle.backend).toBe("git");
    expect(handle.cwd).toContain(path.join(tmpHome, ".teo", "worktrees", "proj-git-test"));
    expect(fs.existsSync(handle.cwd)).toBe(true);
    await gitTree.close("ws-git-01");
  });

  it("git backend: the branch teo/ws-<wsId> is created", async () => {
    const { execSync } = await_require_execSync();
    await gitTree.allocate("ws-git-branch", "git");

    // List branches in the git worktree
    const branches = execSync("git branch --list teo/ws-ws-git-branch", {
      cwd: gitProjectDir,
    }).toString();
    expect(branches).toContain("teo/ws-ws-git-branch");

    await gitTree.close("ws-git-branch");
  });

  it("git backend: close() removes the worktree", async () => {
    const handle = await gitTree.allocate("ws-git-close", "git");
    const worktreePath = handle.cwd;
    expect(fs.existsSync(worktreePath)).toBe(true);
    await gitTree.close("ws-git-close");
    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  it("git backend: allocate() throws GIT_ERROR when git worktree add fails (branch already exists)", async () => {
    const { execSync } = await_require_execSync();
    // Pre-create the branch so git worktree add -b fails on branch already exists
    execSync("git branch teo/ws-ws-git-conflict", { cwd: gitProjectDir, stdio: "ignore" });

    await expect(gitTree.allocate("ws-git-conflict", "git")).rejects.toThrow(/GIT_ERROR/i);
  });

  it("git backend: allocate() throws 'already allocated' when worktree dir exists on disk", async () => {
    // Pre-create the worktree directory to simulate a stale/leaked allocation
    const worktreeDir = path.join(tmpHome, ".teo", "worktrees", "proj-git-test", "ws-git-stale");
    fs.mkdirSync(worktreeDir, { recursive: true });

    await expect(gitTree.allocate("ws-git-stale", "git")).rejects.toThrow(/already allocated/i);
  });

  it("git backend: close() falls back to fs.rmSync when git worktree remove fails", async () => {
    const handle = await gitTree.allocate("ws-git-fallback", "git");
    const worktreePath = handle.cwd;
    expect(fs.existsSync(worktreePath)).toBe(true);

    // Destroy the main repo's git state so `git worktree remove` will fail,
    // which triggers the fs.rmSync fallback in closeGit().
    // Corrupt git by removing its objects dir — worktree remove will error
    const gitDir = path.join(gitProjectDir, ".git");
    fs.rmSync(path.join(gitDir, "config"), { force: true });
    // Rename the main git dir so git can't find the repo
    fs.renameSync(gitDir, gitDir + ".bak");

    // close() should succeed via the fs.rmSync fallback, not throw
    await expect(gitTree.close("ws-git-fallback")).resolves.toBeUndefined();
    expect(fs.existsSync(worktreePath)).toBe(false);

    // Restore for afterEach cleanup
    fs.renameSync(gitDir + ".bak", gitDir);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — git backend on non-git directory (error path)
// ---------------------------------------------------------------------------

describe("WorkstreamTree — git backend on non-git directory", () => {
  it("git backend: allocate() on a non-git projectDir throws a clear error", async () => {
    // tmpProjectDir has a .git folder from beforeEach, use a fresh non-git dir
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-non-git-"));
    fs.writeFileSync(path.join(nonGitDir, "file.ts"), "export const y = 2;\n");

    const tree = new WorkstreamTree({
      projectId: "proj-not-git",
      projectDir: nonGitDir,
      baseDir: tmpHome,
    });

    await expect(tree.allocate("ws-notgit", "git")).rejects.toThrow(
      /not a git repo|git init|GIT_ERROR/i
    );

    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function getAllFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}
