/**
 * workstream-tree — isolates the working tree per workstream so multiple plans
 * run in parallel without clobbering each other's files.
 *
 * A workstream = one plan executing. Run-state already isolates per plan_id
 * (events/<plan_id>.jsonl), so the only thing to isolate is the working tree.
 * This module resolves a per-workstream cwd before a run and reconciles it after.
 * The core step-runner, telemetry, signing, and plan schema are untouched —
 * everything funnels through one field, opts.cwd.
 *
 * Backends:
 *   sandbox  copy-on-create into ~/.teo/worktrees/<pid>/<ws-id>/ (honors ignores)
 *   none     run in the live tree, serialized by a filesystem lock
 *   git      `git worktree` — integration-tested (needs a real repo), not here
 *
 * Reconcile is human-gated: it reports/stages changes and emits an apply script,
 * but never writes them back to the live tree itself. See
 * docs/architecture/TEO-5-workstream-isolation.md.
 */
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { TeoHome } from "../home/home.js";

export type Backend = "sandbox" | "none" | "git";
export type WorkstreamState = "running" | "pending-human" | "reconciled" | "released";

/** One append-only registry line — a workstream lifecycle event. */
export interface RegistryRow {
  ws_id: string;
  plan_id: string;
  backend: Backend;
  cwd: string;
  branch: string | null;
  state: WorkstreamState;
  acquired_at: string;
  ts: string;
}

/** The latest known state of a workstream (collapsed from the registry). */
export type WorkstreamHandle = RegistryRow;

export interface AcquireResult {
  cwd: string;
  backend: Backend;
  branch: string | null;
}

export interface AcquireOptions {
  projectRoot: string;
  projectId: string;
  workstreamId: string;
  planId: string;
  ts: string;
  /** Force a backend; omitted → auto-detect (git if present, else sandbox). */
  isolation?: Backend;
}

export interface ReconcileOptions {
  projectRoot: string;
  projectId: string;
  workstreamId: string;
  ts: string;
}

export interface ReconcileReport {
  ws_id: string;
  backend: Backend;
  created: string[];
  modified: string[];
  deleted: string[];
  /** sandbox: the staged changeset dir + a human-runnable apply script. */
  changesetDir: string;
  applyScript: string;
}

export interface ReleaseOptions {
  projectId: string;
  workstreamId: string;
  ts: string;
}

// Dirs never copied into a sandbox — heavy and derivable.
const DEFAULT_IGNORES = ["node_modules", ".git", "dist", ".teo-changeset"];

// ── registry (append-only, mirrors telemetry discipline) ──────────────────────

function projectDir(home: TeoHome, projectId: string): string {
  return join(home.worktreesDir, projectId);
}

function registryFile(home: TeoHome, projectId: string): string {
  return join(projectDir(home, projectId), "registry.jsonl");
}

/** All registry rows for a project, in written order. Empty if none. */
export function readRegistry(home: TeoHome, projectId: string): RegistryRow[] {
  const file = registryFile(home, projectId);
  if (!existsSync(file)) return [];
  const out: RegistryRow[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    out.push(JSON.parse(trimmed) as RegistryRow);
  }
  return out;
}

/** Append one lifecycle row. Never mutates an existing line. */
export function appendRegistry(home: TeoHome, projectId: string, row: RegistryRow): void {
  const dir = projectDir(home, projectId);
  mkdirSync(dir, { recursive: true });
  appendFileSync(registryFile(home, projectId), `${JSON.stringify(row)}\n`);
}

/** Latest state per ws_id, collapsed from the append-only log. */
export function listWorkstreams(home: TeoHome, projectId: string): WorkstreamHandle[] {
  const latest = new Map<string, RegistryRow>();
  for (const row of readRegistry(home, projectId)) {
    latest.set(row.ws_id, row);
  }
  return [...latest.values()];
}

function latestRow(home: TeoHome, projectId: string, wsId: string): RegistryRow | null {
  let found: RegistryRow | null = null;
  for (const row of readRegistry(home, projectId)) {
    if (row.ws_id === wsId) found = row;
  }
  return found;
}

// ── ignore handling ───────────────────────────────────────────────────────────

/** Read .teoignore (newline list) from the project root; merged with defaults. */
function ignoreSet(projectRoot: string): Set<string> {
  const ignores = new Set(DEFAULT_IGNORES);
  const file = join(projectRoot, ".teoignore");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && !trimmed.startsWith("#")) ignores.add(trimmed);
    }
  }
  return ignores;
}

// ── tree walking (for sandbox reconcile diff) ─────────────────────────────────

/** Relative paths of every file under root, skipping ignored top-level dirs. */
function walkFiles(root: string, ignores: Set<string>): string[] {
  const out: string[] = [];
  const recurse = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);
      // Ignore by top-level segment or exact relative path.
      const top = rel.split(/[\\/]/)[0];
      if (ignores.has(top) || ignores.has(rel)) continue;
      if (entry.isDirectory()) {
        recurse(abs);
      } else {
        out.push(rel);
      }
    }
  };
  recurse(root);
  return out;
}

function sameContent(a: string, b: string): boolean {
  return readFileSync(a).equals(readFileSync(b));
}

// ── acquire ───────────────────────────────────────────────────────────────────

/**
 * Acquire an isolated working tree for a workstream. Returns the cwd a run
 * should execute in. Records a `running` lifecycle row.
 */
export async function acquireWorkstream(home: TeoHome, opts: AcquireOptions): Promise<AcquireResult> {
  const backend: Backend = opts.isolation ?? detectBackend(opts.projectRoot);

  const prior = latestRow(home, opts.projectId, opts.workstreamId);
  if (prior && prior.state !== "released") {
    throw new Error(`workstream ${opts.workstreamId} is already live (state=${prior.state})`);
  }

  let cwd: string;
  const branch: string | null = backend === "git" ? `teo/ws-${opts.workstreamId}` : null;

  if (backend === "none") {
    acquireLock(home, opts.projectId, opts.workstreamId);
    cwd = opts.projectRoot;
  } else if (backend === "sandbox") {
    cwd = createSandbox(home, opts);
  } else {
    // git backend: integration-tested against a real repo. The unit path never
    // reaches here (tests force sandbox/none); guard so the contract is explicit.
    throw new Error("git backend is created via the git integration path, not the unit module");
  }

  appendRegistry(home, opts.projectId, {
    ws_id: opts.workstreamId,
    plan_id: opts.planId,
    backend,
    cwd,
    branch,
    state: "running",
    acquired_at: opts.ts,
    ts: opts.ts,
  });

  return { cwd, backend, branch };
}

/** A git repo at the root → git backend; otherwise sandbox. */
function detectBackend(projectRoot: string): Backend {
  return existsSync(join(projectRoot, ".git")) ? "git" : "sandbox";
}

function sandboxDir(home: TeoHome, projectId: string, wsId: string): string {
  return join(projectDir(home, projectId), wsId);
}

/** Copy the project tree (minus ignores) into the sandbox dir; return it. */
function createSandbox(home: TeoHome, opts: AcquireOptions): string {
  const dest = sandboxDir(home, opts.projectId, opts.workstreamId);
  const ignores = ignoreSet(opts.projectRoot);
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(opts.projectRoot, { withFileTypes: true })) {
    if (ignores.has(entry.name)) continue;
    cpSync(join(opts.projectRoot, entry.name), join(dest, entry.name), { recursive: true });
  }
  return dest;
}

// ── none-backend lock ─────────────────────────────────────────────────────────

function lockFile(home: TeoHome, projectId: string): string {
  return join(projectDir(home, projectId), ".lock");
}

function acquireLock(home: TeoHome, projectId: string, wsId: string): void {
  const lock = lockFile(home, projectId);
  mkdirSync(projectDir(home, projectId), { recursive: true });
  if (existsSync(lock)) {
    throw new Error(`project tree lock held — another workstream is in use (serial); cannot run ${wsId}`);
  }
  writeFileSync(lock, `${wsId}\n`, { flag: "wx" });
}

function releaseLock(home: TeoHome, projectId: string): void {
  const lock = lockFile(home, projectId);
  if (existsSync(lock)) rmSync(lock);
}

// ── reconcile ─────────────────────────────────────────────────────────────────

/**
 * Compare the workstream tree against the live project tree and report the
 * change set. Human-gated: stages the changes + an apply script but does NOT
 * write them back. A `none` workstream has no separate tree → empty report.
 */
export async function reconcileWorkstream(home: TeoHome, opts: ReconcileOptions): Promise<ReconcileReport> {
  const row = latestRow(home, opts.projectId, opts.workstreamId);
  if (!row) throw new Error(`unknown workstream: ${opts.workstreamId}`);

  const empty: ReconcileReport = {
    ws_id: opts.workstreamId,
    backend: row.backend,
    created: [],
    modified: [],
    deleted: [],
    changesetDir: "",
    applyScript: "",
  };

  if (row.backend === "none") {
    return empty;
  }

  const ignores = ignoreSet(opts.projectRoot);
  const tree = row.cwd;
  const liveFiles = new Set(walkFiles(opts.projectRoot, ignores));
  const treeFiles = new Set(walkFiles(tree, ignores));

  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const rel of treeFiles) {
    if (!liveFiles.has(rel)) {
      created.push(rel);
    } else if (!sameContent(join(tree, rel), join(opts.projectRoot, rel))) {
      modified.push(rel);
    }
  }
  for (const rel of liveFiles) {
    if (!treeFiles.has(rel)) deleted.push(rel);
  }

  const changesetDir = join(tree, ".teo-changeset");
  rmSync(changesetDir, { recursive: true, force: true });
  mkdirSync(changesetDir, { recursive: true });

  // Stage created + modified file contents under the changeset dir.
  for (const rel of [...created, ...modified]) {
    const target = join(changesetDir, "files", rel);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(join(tree, rel), target);
  }
  writeFileSync(
    join(changesetDir, "manifest.json"),
    `${JSON.stringify({ ws_id: opts.workstreamId, created, modified, deleted, ts: opts.ts }, null, 2)}\n`,
  );

  const applyScript = join(changesetDir, "apply-changeset.sh");
  writeFileSync(applyScript, buildApplyScript(opts.projectRoot, created, modified, deleted), { mode: 0o755 });

  appendRegistry(home, opts.projectId, { ...row, state: "reconciled", ts: opts.ts });

  return { ws_id: opts.workstreamId, backend: row.backend, created, modified, deleted, changesetDir, applyScript };
}

/** A human-runnable script that applies the changeset to the live tree. */
function buildApplyScript(projectRoot: string, created: string[], modified: string[], deleted: string[]): string {
  const lines = ["#!/usr/bin/env bash", "# Apply this workstream's changes to the live tree. Review before running.", "set -euo pipefail", `LIVE=${JSON.stringify(projectRoot)}`, 'HERE="$(cd "$(dirname "$0")" && pwd)"', ""];
  for (const rel of [...created, ...modified]) {
    lines.push(`mkdir -p "$LIVE/$(dirname ${JSON.stringify(rel)})"`);
    lines.push(`cp "$HERE/files/${rel}" "$LIVE/${rel}"`);
  }
  for (const rel of deleted) {
    lines.push(`rm -f "$LIVE/${rel}"`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── release ───────────────────────────────────────────────────────────────────

/** Tear down the workstream's tree (sandbox) or lock (none); record released. */
export async function releaseWorkstream(home: TeoHome, opts: ReleaseOptions): Promise<void> {
  const row = latestRow(home, opts.projectId, opts.workstreamId);
  if (!row) throw new Error(`unknown workstream: ${opts.workstreamId}`);

  if (row.backend === "none") {
    releaseLock(home, opts.projectId);
  } else if (row.backend === "sandbox") {
    rmSync(row.cwd, { recursive: true, force: true });
  }

  appendRegistry(home, opts.projectId, { ...row, state: "released", ts: opts.ts });
}
