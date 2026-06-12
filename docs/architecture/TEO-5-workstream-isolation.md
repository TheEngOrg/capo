# TEO 5 — Parallel Workstream Isolation

Status: **PROPOSAL — pending approval**
Extends: [`TEO-5.md`](./TEO-5.md) §8 (lifts the "tasks run strictly sequentially / parallel is a non-goal" limit at the *workstream* level — not the task level).
Decision record: ADR-060 (RAG).

This is a Step-1 design doc. No `src/` code is written until it's approved.

---

## 1. The problem

A run today takes `cwd: process.cwd()` and a `project_id` hashed from git-remote-or-abspath
(`src/cli/teo.ts:53,76`, `src/core/home/home.ts:91`). Two workstreams in the same repo
therefore share:

- **the working tree** — both runs' SCRIPT tasks and verifications execute against the same
  files. Concurrent builds/edits collide. **This is the real pain.**
- **the `project_id` namespace** — but run-state is keyed per *plan* (`events/<plan_id>.jsonl`),
  so telemetry does *not* collide. Finance still rolls up correctly per project.

So the scope is narrow and clean: **isolate the working tree per workstream. Leave run-state
as-is.** A workstream is one plan executing; "parallel workstreams" = N plans running at once,
each in its own tree, all writing telemetry into the same per-project `~/.teo/` namespace.

```
                     ~/.teo/memory/<project-id>/        ← shared, per-plan files (no collision)
                              ▲
        ┌─────────────────────┼─────────────────────┐
   plan A (ws-a)          plan B (ws-b)          plan C (ws-c)
   cwd = tree-a           cwd = tree-b           cwd = tree-c     ← ISOLATED working trees
```

## 2. The seam

The orchestrator already funnels every file-touching operation through one field: `opts.cwd`
(`orchestrator.ts:42`). SCRIPT tasks, AGENT spawns, and verifications all run there. So
isolation needs exactly one new responsibility: **resolve a per-workstream `cwd` before the
run, reconcile it after.** No change to the step-runner, telemetry, signing, or plan schema.

```
teo run <plan> --workstream <ws-id>
        │
        ▼
  workstream-tree.acquire(project_root, ws-id)   →  returns an isolated cwd
        │                                            (git worktree OR copied sandbox)
        ▼
  runPlan(home, paths, plan, { cwd })            ←  unchanged core
        │
        ▼
  pending-human                                     run completes; tree is parked, not destroyed
        │
        ▼  (on teo gate accept / teo workstream close)
  workstream-tree.reconcile(ws-id)               →  merge-back (git) or diff-report (sandbox)
```

## 3. Two backends, one interface

A new module `workstream-tree` exposes a backend-agnostic interface. It auto-detects git at
the project root and picks a backend; `--isolation git|sandbox|none` can force one.

```ts
interface WorkstreamTree {
  acquire(opts: { projectRoot: string; workstreamId: string }): Promise<{ cwd: string; backend: "git" | "sandbox" }>;
  reconcile(opts: { workstreamId: string }): Promise<ReconcileReport>;
  release(opts: { workstreamId: string }): Promise<void>;   // tear down the tree
  list(): WorkstreamHandle[];
}
```

### 3a. Git backend — `git worktree`

When the project root is a git repo:

- `acquire` → `git worktree add ~/.teo/worktrees/<project-id>/<ws-id> -b teo/ws-<ws-id>`
  (or attach to an existing branch). Returns that path as `cwd`.
- The run executes against a real, independent checkout. Git already guarantees tree
  isolation — this is what worktrees are for.
- `reconcile` → does **not** auto-merge. Emits a report: branch name, commit/diff summary,
  and the exact `git merge teo/ws-<ws-id>` (or PR) command a human runs. Merge is a human
  decision, consistent with TEO 5's human-gate philosophy — the engine delivers and parks,
  it doesn't push to your main branch on its own.
- `release` → `git worktree remove` (refuses if dirty unless `--force`).

### 3b. Sandbox backend — copy-on-create (non-git)

When there's no git repo (or `--isolation sandbox`):

- `acquire` → copy the project tree into `~/.teo/worktrees/<project-id>/<ws-id>/`, honoring
  ignore rules (skip `node_modules/`, `.git/`, `dist/`, anything in `.teoignore` /
  `.gitignore` if present). Returns that path as `cwd`.
- The run executes against the copy. The original tree is never touched mid-run.
- `reconcile` → compute a per-file diff between the sandbox and the live tree. Emit a
  **change report** (created / modified / deleted) and stage the changes under
  `~/.teo/worktrees/<project-id>/<ws-id>/.teo-changeset/` plus a human-runnable
  `apply-changeset.sh` (rsync/cp of exactly the changed files back). Apply is human-gated,
  same as the git merge.
- `release` → remove the sandbox dir.

The copy cost is real (a `cp -R` of a working tree). Mitigations: honor ignores aggressively
(the heavy dirs are derivable), and `--isolation none` exists for tiny/throwaway workstreams.

### 3c. `none` backend — shared tree + write lock

Escape hatch for the cheap case: no separate tree. A filesystem advisory lock
(`~/.teo/worktrees/<project-id>/.lock`, acquired for the run's duration) serializes writers so
two `none` workstreams don't interleave writes. They block instead of truly parallelizing —
honest tradeoff, logged so it's not silently serial.

## 4. Workstream registry

A workstream is a first-class, listable thing. Append-only, lives in `~/.teo/`:

```
~/.teo/
  worktrees/
    <project-id>/
      <ws-id>/                     # the isolated tree (git worktree or sandbox copy)
      registry.jsonl               # append-only: ws lifecycle events
```

```jsonc
// registry.jsonl line
{ "ws_id": "ws-a", "plan_id": "uuid", "backend": "git", "cwd": "...",
  "branch": "teo/ws-ws-a", "state": "running|pending-human|reconciled|released",
  "acquired_at": "ISO", "ts": "ISO" }
```

`teo workstream list` reads it. State transitions emit a line; nothing is mutated. This is the
same append-only discipline as the telemetry ledger — the registry is auditable too.

## 5. CLI surface (additions only)

| Command | What it does |
|---------|--------------|
| `teo run <plan> --workstream <ws-id> [--isolation git\|sandbox\|none]` | acquire tree → run → park |
| `teo workstream list` | live workstreams + state + backend + tree path |
| `teo workstream diff <ws-id>` | the reconcile report without applying |
| `teo workstream close <ws-id>` | reconcile (merge-cmd / changeset) + release the tree |

Existing verbs are unchanged. Omitting `--workstream` runs in `process.cwd()` exactly as today
(backward compatible — single-stream stays simple).

## 6. What this deliberately does NOT do

- **No auto-merge / auto-apply.** The engine isolates and reconciles; a human applies. Pushing
  to the live tree is a gated decision, like the human final gate.
- **No task-level parallelism.** Tasks within one plan still run sequentially by `task_order`
  (TEO-5.md §8 stands). This proposal parallelizes *workstreams* (whole plans), not tasks.
- **No new run-state namespace.** Telemetry/finance stay per-plan under the project namespace;
  they already don't collide. Adding a per-workstream namespace was considered and rejected as
  unnecessary — `plan_id` is already the unit of isolation for state.
- **No DAG / dependency graph between workstreams.** They're independent. Cross-workstream
  ordering, if ever needed, is a separate proposal.

## 7. Open items (decide during build)

- Sandbox copy engine: `cp -R` vs `rsync --exclude-from` vs a tar pipe. rsync gives ignore
  handling + a cheap diff for reconcile, but isn't guaranteed present. Lean rsync-with-cp-fallback.
- Lock implementation for `none`: `flock`-style vs a lockfile with pid+mtime staleness (mirrors
  the existing `teo-session-active` loop-guard pattern).
- Disk GC: when to auto-`release` reconciled trees (TTL? on `close` only? `teo workstream prune`?).
- `.teoignore` format — reuse `.gitignore` syntax, or a simpler newline list.
- Whether `teo plan` should pre-assign a `ws-id` so the whole plan→run→gate→close arc carries
  one stable workstream handle.

## 8. Component map (build order, tests-first)

| # | Module | Responsibility |
|---|--------|----------------|
| 1 | `workstream-tree` (interface + registry) | acquire/reconcile/release/list; append-only registry r/w |
| 2 | `workstream-tree/git` | `git worktree` backend; reconcile = branch + merge-cmd report |
| 3 | `workstream-tree/sandbox` | copy-on-create backend; reconcile = changeset + apply script |
| 4 | `workstream-tree/none` | shared-tree write lock |
| 5 | `cli` additions | `--workstream`, `--isolation`, `teo workstream list/diff/close` |

The deterministic core stays deterministic: tree resolution is pure filesystem/git mechanics,
unit-testable without a model, gated at the same 100% bar as the rest of `src/core/**`.
