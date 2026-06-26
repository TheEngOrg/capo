# Verification Gate Protocol

## Purpose

The verification gate is a VCS-agnostic quality enforcement system that fires at **task completion**, not at VCS commit. This design ensures that quality checks run regardless of whether the project uses git, svn, mercurial, or no version control at all.

The verification gate is the primary enforcement mechanism. VCS-level intercepts (e.g., blocking `git commit --no-verify`) are an optional, additive layer — not a requirement.

---

## Architecture

### Enforcement Stack

```
Primary:    TaskCompleted hook (fires for ALL task completions)
Secondary:  Capo verification gate (before reporting pipeline "done")
Bonus:      PreToolUse on VCS commands (if configured per project)
```

**Why TaskCompleted is primary:** Claude Code's `TaskCompleted` hook fires whenever any agent or teammate marks work as done. This is universal — it does not depend on VCS, build tools, or language runtime. Every task goes through it.

**Why VCS intercept is bonus:** Not all projects use git. Not all work results in a commit. VCS intercepts are project-specific configuration layered on top of the universal gate.

---

## Enforcement Levels

Three configurable levels control how strictly the verification gate enforces quality checks:

| Level | TaskCompleted Behavior | Capo Behavior | VCS Intercept |
|-------|----------------------|---------------|---------------|
| **strict** | BLOCK if any check fails (exit non-zero) | Verify before reporting done — refuse if FAIL | PreToolUse BLOCKS VCS commit on failure |
| **standard** | WARN if checks fail (exit 0 with warnings) | Verify before reporting done — warn if FAIL | PreToolUse WARNS on VCS commit failure |
| **light** | LOG results only (exit 0, always) | Log results, do not gate | No VCS intercept |

### Default Level

The default enforcement level is **strict** for `client-beta` and `contributor` installs. New installs without a `.claude/verification-level` file also default to `strict`. `pilot-alpha` installs are seeded with `standard` during `teo-init` to preserve co-debug behavior with design partners.

To revert to advisory mode: `echo standard > .claude/verification-level`, or prefix any git command with `TEO_VERIFICATION_LEVEL=standard` for a single-session override.

---

## Configuration

### Where the Level is Stored

The enforcement level is read from these sources in priority order:

1. **Environment variable:** `TEO_VERIFICATION_LEVEL=strict|standard|light`
2. **Config file:** `.claude/verification-level` (single line: `strict`, `standard`, or `light`)
3. **Default:** `standard` (used when neither source exists)

### Setting the Level

- **At install time:** `teo-init --tier <tier>` is the canonical method. It writes the tier-appropriate default to `.claude/verification-level` (strict for `client-beta`/`contributor`, standard for `pilot-alpha`). Use `--reset-verification-level` alongside `--force` to overwrite an existing file.
- **Per-session override:** Set `TEO_VERIFICATION_LEVEL` in the environment before starting Claude Code
- **Persistent change:** Write the desired level to `.claude/verification-level`

---

## Checks

The verification gate runs a configurable set of checks based on the enforcement level:

### All Levels (light, standard, strict)

| Check | What It Verifies | Pass Condition |
|-------|------------------|----------------|
| **structural-integrity** | Framework structural validation | `teo-validate` exits 0 |
| **count-freshness** | CLAUDE.md counts match disk | Agent/skill/protocol counts match actual |

### Standard and Strict Only

| Check | What It Verifies | Pass Condition |
|-------|------------------|----------------|
| **test-execution** | Tests were run since last source edit | Test runner exit code 0 (if test runner available) |
| **docs-freshness** | Related docs updated with source changes | At least one doc file staged alongside source |

### Strict Only

| Check | What It Verifies | Pass Condition |
|-------|------------------|----------------|
| **process-flow-compliance** | All required gates in active flow satisfied | No skipped or failed gates in pipeline state |

---

## Output Format

The verification gate produces structured results, not just pass/fail:

```
=== Verification Gate (standard) ===
  [PASS] structural-integrity — teo-validate passed
  [WARN] test-execution — tests not run since last source edit
  [PASS] docs-freshness — documentation updated
  [PASS] count-freshness — CLAUDE.md counts match disk
=== Result: WARN (1 warning, 0 failures) ===
```

Each check reports one of three statuses:

| Status | Meaning |
|--------|---------|
| **PASS** | Check satisfied |
| **WARN** | Check not satisfied, advisory only |
| **FAIL** | Check not satisfied, blocks in strict mode |

---

## Gate Classification

All verification gate checks are classified as `resolution: auto`. They have deterministic pass/fail conditions evaluated by scripts — no human judgment required.

See `.claude/shared/gate-classification-protocol.md` for classification criteria.

---

## Capo Verification (Secondary Layer)

Before reporting any pipeline as "done" to the user, the Capo runs its own verification:

1. **Process flow compliance:** Were all required gates in the active flow satisfied?
2. **Gate skip audit:** Were any gates skipped during execution?
3. **Verification level check:** Does the current result satisfy the configured level?

### Capo Behavior by Level

| Level | On FAIL | On WARN |
|-------|---------|---------|
| **strict** | Do NOT report done. Report what failed and what must be fixed. | Report done with warnings listed. |
| **standard** | Report done with warnings. | Report done with warnings. |
| **light** | Report done. Log results in pipeline log. | Report done. Log results. |

---

## VCS Intercept (Bonus Layer)

The VCS intercept is an **optional, additive** layer configured per-project based on the VCS in use. It is NOT required for the verification gate to function.

### Configuration Examples

**For git projects** (in `settings.json`):
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/vcs-intercept.sh"
          }
        ]
      }
    ]
  }
}
```

**For svn projects:** Same structure, intercept script checks for `svn commit` commands.

### What the VCS Intercept Does

1. Detects VCS commit commands (e.g., `git commit`, `svn commit`)
2. Runs the same verification checks as TaskCompleted
3. In strict mode: blocks the commit if checks fail
4. In standard mode: warns but allows the commit
5. In light mode: not installed (no VCS intercept)

### What the VCS Intercept Does NOT Do

- Replace the TaskCompleted gate (TaskCompleted is always primary)
- Run for non-VCS operations
- Work without explicit per-project configuration

---

## Adding the Verification Gate to a New Project

1. Run `mg-init` — sets enforcement level during routing preferences
2. The `TaskCompleted` hook is always installed (via `settings.json`)
3. Optionally configure VCS intercept for the project's VCS
4. The Capo secondary verification runs automatically during pipeline execution

---

## Verification Gate Registry

All verification gate checks, registered in the gate classification system:

| Gate | Resolution | Rationale |
|------|------------|-----------|
| structural-integrity (teo-validate) | auto | Script exit code |
| count-freshness (CLAUDE.md counts) | auto | Count comparison |
| test-execution (test runner) | auto | Exit code check |
| docs-freshness (doc staging) | auto | File staging check |
| process-flow-compliance (pipeline state) | auto | Gate status check |
