import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveTeoHome, type TeoHome } from "../../../src/core/home/home.js";
import {
  acquireWorkstream,
  reconcileWorkstream,
  releaseWorkstream,
  listWorkstreams,
  readRegistry,
  appendRegistry,
  type WorkstreamHandle,
} from "../../../src/core/workstream-tree/workstream-tree.js";

let sandbox: string;
let home: TeoHome;
let projectRoot: string;
const PID = "proj0000";
const TS = "2026-06-12T00:00:00.000Z";

/** Build a small project tree to isolate. */
function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), "teo-ws-project-"));
  writeFileSync(join(root, "a.txt"), "hello\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\n");
  // Heavy, ignorable dirs that must NOT be copied into a sandbox.
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules", "junk.js"), "// huge\n");
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return root;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-ws-home-"));
  home = resolveTeoHome({ TEO_HOME: sandbox });
  projectRoot = seedProject();
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("registry", () => {
  it("returns an empty list when no registry file exists", () => {
    expect(readRegistry(home, PID)).toEqual([]);
    expect(listWorkstreams(home, PID)).toEqual([]);
  });

  it("appends a lifecycle line and reads it back", () => {
    appendRegistry(home, PID, {
      ws_id: "ws-a",
      plan_id: "plan-1",
      backend: "sandbox",
      cwd: "/tmp/x",
      branch: null,
      state: "running",
      acquired_at: TS,
      ts: TS,
    });
    const rows = readRegistry(home, PID);
    expect(rows).toHaveLength(1);
    expect(rows[0].ws_id).toBe("ws-a");
    expect(rows[0].state).toBe("running");
  });

  it("is append-only — a state change adds a line, never mutates", () => {
    appendRegistry(home, PID, { ws_id: "ws-a", plan_id: "p", backend: "sandbox", cwd: "/tmp/x", branch: null, state: "running", acquired_at: TS, ts: TS });
    appendRegistry(home, PID, { ws_id: "ws-a", plan_id: "p", backend: "sandbox", cwd: "/tmp/x", branch: null, state: "reconciled", acquired_at: TS, ts: TS });
    expect(readRegistry(home, PID)).toHaveLength(2);
  });

  it("listWorkstreams collapses to the latest state per ws_id", () => {
    appendRegistry(home, PID, { ws_id: "ws-a", plan_id: "p", backend: "sandbox", cwd: "/tmp/a", branch: null, state: "running", acquired_at: TS, ts: TS });
    appendRegistry(home, PID, { ws_id: "ws-b", plan_id: "q", backend: "none", cwd: "/tmp/b", branch: null, state: "running", acquired_at: TS, ts: TS });
    appendRegistry(home, PID, { ws_id: "ws-a", plan_id: "p", backend: "sandbox", cwd: "/tmp/a", branch: null, state: "released", acquired_at: TS, ts: TS });
    const live: WorkstreamHandle[] = listWorkstreams(home, PID);
    const a = live.find((w) => w.ws_id === "ws-a");
    const b = live.find((w) => w.ws_id === "ws-b");
    expect(live).toHaveLength(2);
    expect(a?.state).toBe("released");
    expect(b?.state).toBe("running");
  });

  it("skips blank lines defensively", () => {
    appendRegistry(home, PID, { ws_id: "ws-a", plan_id: "p", backend: "sandbox", cwd: "/tmp/x", branch: null, state: "running", acquired_at: TS, ts: TS });
    const { appendFileSync } = require("node:fs");
    appendFileSync(join(home.worktreesDir, PID, "registry.jsonl"), "\n\n");
    expect(readRegistry(home, PID)).toHaveLength(1);
  });
});

describe("acquireWorkstream — sandbox backend", () => {
  it("copies the project tree into ~/.teo/worktrees/<pid>/<ws-id>/", async () => {
    const h = await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS });
    expect(h.backend).toBe("sandbox");
    expect(h.cwd).toBe(join(home.worktreesDir, PID, "ws-a"));
    expect(existsSync(join(h.cwd, "a.txt"))).toBe(true);
    expect(readFileSync(join(h.cwd, "src", "index.ts"), "utf8")).toContain("export const x");
  });

  it("does NOT copy ignored heavy dirs (node_modules, .git)", async () => {
    const h = await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS });
    expect(existsSync(join(h.cwd, "node_modules"))).toBe(false);
    expect(existsSync(join(h.cwd, ".git"))).toBe(false);
  });

  it("records a running lifecycle line in the registry", async () => {
    await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS });
    const rows = readRegistry(home, PID);
    expect(rows.at(-1)?.state).toBe("running");
    expect(rows.at(-1)?.backend).toBe("sandbox");
  });

  it("refuses to acquire a ws-id that is already live", async () => {
    await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS });
    await expect(
      acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS }),
    ).rejects.toThrow(/already (live|active)/i);
  });

  it("honors a .teoignore file in the project root", async () => {
    writeFileSync(join(projectRoot, ".teoignore"), "a.txt\n");
    const h = await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS });
    expect(existsSync(join(h.cwd, "a.txt"))).toBe(false);
    expect(existsSync(join(h.cwd, "src", "index.ts"))).toBe(true);
  });
});

describe("reconcileWorkstream — sandbox backend", () => {
  it("reports created / modified / deleted files vs the live tree", async () => {
    const h = await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS });
    // Mutate the sandbox: modify a.txt, add new.txt, delete src/index.ts.
    writeFileSync(join(h.cwd, "a.txt"), "changed\n");
    writeFileSync(join(h.cwd, "new.txt"), "new\n");
    rmSync(join(h.cwd, "src", "index.ts"));

    const report = await reconcileWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", ts: TS });
    expect(report.modified).toContain("a.txt");
    expect(report.created).toContain("new.txt");
    expect(report.deleted).toContain(join("src", "index.ts"));
  });

  it("writes a changeset + apply script and records a reconciled line", async () => {
    const h = await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS });
    writeFileSync(join(h.cwd, "new.txt"), "new\n");
    const report = await reconcileWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", ts: TS });
    expect(existsSync(report.changesetDir)).toBe(true);
    expect(existsSync(report.applyScript)).toBe(true);
    expect(readRegistry(home, PID).at(-1)?.state).toBe("reconciled");
  });

  it("reports no changes for an untouched sandbox", async () => {
    await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS });
    const report = await reconcileWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", ts: TS });
    expect(report.created).toEqual([]);
    expect(report.modified).toEqual([]);
    expect(report.deleted).toEqual([]);
  });

  it("throws reconciling an unknown workstream", async () => {
    await expect(
      reconcileWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ghost", ts: TS }),
    ).rejects.toThrow(/unknown|not found/i);
  });
});

describe("releaseWorkstream", () => {
  it("removes the sandbox tree and records a released line", async () => {
    const h = await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS });
    expect(existsSync(h.cwd)).toBe(true);
    await releaseWorkstream(home, { projectId: PID, workstreamId: "ws-a", ts: TS });
    expect(existsSync(h.cwd)).toBe(false);
    expect(readRegistry(home, PID).at(-1)?.state).toBe("released");
  });

  it("is idempotent — releasing an already-released ws is a no-op line", async () => {
    await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-a", isolation: "sandbox", planId: "plan-1", ts: TS });
    await releaseWorkstream(home, { projectId: PID, workstreamId: "ws-a", ts: TS });
    await releaseWorkstream(home, { projectId: PID, workstreamId: "ws-a", ts: TS });
    const released = readRegistry(home, PID).filter((r) => r.state === "released");
    expect(released.length).toBeGreaterThanOrEqual(1);
  });

  it("throws releasing an unknown workstream", async () => {
    await expect(
      releaseWorkstream(home, { projectId: PID, workstreamId: "ghost", ts: TS }),
    ).rejects.toThrow(/unknown|not found/i);
  });
});

describe("acquireWorkstream — none backend", () => {
  it("runs in the live project tree (no copy) and takes a lock", async () => {
    const h = await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-n", isolation: "none", planId: "plan-1", ts: TS });
    expect(h.backend).toBe("none");
    expect(h.cwd).toBe(projectRoot);
    expect(existsSync(join(home.worktreesDir, PID, ".lock"))).toBe(true);
  });

  it("refuses a second none-workstream while the lock is held", async () => {
    await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-n", isolation: "none", planId: "plan-1", ts: TS });
    await expect(
      acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-m", isolation: "none", planId: "plan-2", ts: TS }),
    ).rejects.toThrow(/lock|in use|serial/i);
  });

  it("releases the lock on release", async () => {
    await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-n", isolation: "none", planId: "plan-1", ts: TS });
    await releaseWorkstream(home, { projectId: PID, workstreamId: "ws-n", ts: TS });
    expect(existsSync(join(home.worktreesDir, PID, ".lock"))).toBe(false);
  });

  it("reconcile on a none workstream is an empty no-op report", async () => {
    await acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-n", isolation: "none", planId: "plan-1", ts: TS });
    const report = await reconcileWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-n", ts: TS });
    expect(report.created).toEqual([]);
    expect(report.modified).toEqual([]);
    expect(report.deleted).toEqual([]);
    expect(report.backend).toBe("none");
  });
});

describe("isolation default + git detection", () => {
  it("defaults to sandbox when isolation is omitted and no git is detected", async () => {
    // Force a non-git root to exercise the sandbox default branch.
    const nogit = mkdtempSync(join(tmpdir(), "teo-ws-nogit-"));
    writeFileSync(join(nogit, "f.txt"), "x\n");
    const h = await acquireWorkstream(home, { projectRoot: nogit, projectId: PID, workstreamId: "ws-d", planId: "plan-1", ts: TS });
    expect(h.backend).toBe("sandbox");
    rmSync(nogit, { recursive: true, force: true });
  });

  it("detects git and routes to the git backend when a .git dir is present", async () => {
    // projectRoot has a .git dir → detectBackend returns "git". The unit module
    // does not create git worktrees (integration path owns that), so acquire
    // throws a clear contract error rather than silently doing the wrong thing.
    await expect(
      acquireWorkstream(home, { projectRoot, projectId: PID, workstreamId: "ws-g", planId: "plan-1", ts: TS }),
    ).rejects.toThrow(/git backend/i);
  });
});
