# Gate Evaluator Protocol

## Purpose

The gate evaluator is the runtime component that checks gate conditions and produces structured verdicts. It receives a gate definition (from the flow registry) and runtime evidence, evaluates the condition using a predefined evaluator, and returns a verdict.

This is the enforcement engine. The harness loads flows and builds the registry. The gate evaluator uses the registry to check whether gates pass or fail during pipeline execution.

---

## Architecture

```
Gate Definition (from registry)     Runtime Evidence (from pipeline)
         |                                    |
         v                                    v
    Gate Evaluator
         |
         v
    Verdict: { gate_name, verdict, evidence, timestamp, evaluator_type }
```

The gate evaluator is stateless. Each evaluation is independent. The evaluator does not track history or state between calls -- that is the pipeline's responsibility.

---

## Evaluator Types

Four predefined evaluator types. No expression language (deferred to Phase 3).

### 1. `script_exit` — Script/Command Exit Code

Runs a script or command and checks the exit code.

**Input:**
```yaml
evaluator: script_exit
config:
  command: ".claude/scripts/teo-validate"
  expected_exit: 0          # default: 0
  timeout_ms: 30000         # default: 30000 (30 seconds)
  working_dir: "."          # default: project root
```

**Evaluation:**
1. Execute `command` in `working_dir`
2. Capture exit code and stdout/stderr
3. Compare exit code to `expected_exit`
4. PASS if match, FAIL if mismatch

**Evidence:**
```json
{
  "command": ".claude/scripts/teo-validate",
  "exit_code": 0,
  "expected": 0,
  "stdout_summary": "All checks passed (0 warnings)",
  "stderr_summary": ""
}
```

**Gate mapping examples:**
- `gate: test_exit_code == 0` -> `script_exit` with `command: "npm test"`
- `gate: lint_exit_code == 0` -> `script_exit` with `command: "npx eslint ."`
- `gate: teo_validate_exit_code == 0` -> `script_exit` with `command: ".claude/scripts/teo-validate"`

---

### 2. `file_exists` — File or Directory Existence

Checks whether a file or directory exists. Supports glob patterns.

**Input:**
```yaml
evaluator: file_exists
config:
  path: "docs/*.md"          # glob pattern or exact path
  match: "any"               # "any" (at least one match) or "all" (all glob results)
  base_dir: "."              # default: project root
```

**Evaluation:**
1. Expand `path` as a glob pattern relative to `base_dir`
2. If `match: "any"`: PASS if at least one file matches
3. If `match: "all"`: PASS if all expected files exist (used with explicit list)

**Evidence:**
```json
{
  "pattern": "docs/*.md",
  "matched_files": ["docs/README.md", "docs/architecture.md"],
  "match_count": 2,
  "match_mode": "any"
}
```

**Gate mapping examples:**
- `gate: docs_staged_with_source` -> `file_exists` with pattern for doc files alongside source changes
- `gate: optimized variant exists` -> `file_exists` with `*-optimized.png` pattern
- `gate: flow-written` -> `file_exists` with `processes/composed/{name}.yaml`

---

### 3. `field_check` — Field Presence in Structured File

Checks whether a specific field or pattern exists in a YAML, JSON, or Markdown file.

**Input:**
```yaml
evaluator: field_check
config:
  file: ".claude/agents/capo.md"
  format: "yaml_frontmatter"   # "json", "yaml", "yaml_frontmatter", "markdown_heading", "text_pattern"
  field: "directive_gate"       # dot-notation path for JSON/YAML, heading text for markdown
  expected: "present"           # "present" (field exists), "equals" (exact match), "contains" (substring)
  value: null                   # required when expected is "equals" or "contains"
```

**Evaluation:**
1. Read `file`
2. Parse according to `format`:
   - `json`: Parse as JSON, traverse dot-notation `field` path
   - `yaml`: Parse as YAML, traverse dot-notation `field` path
   - `yaml_frontmatter`: Extract YAML between `---` delimiters, traverse
   - `markdown_heading`: Search for heading matching `field` text
   - `text_pattern`: Search for regex pattern in `field`
3. Apply `expected` check:
   - `present`: PASS if field/heading/pattern exists
   - `equals`: PASS if value matches `value` exactly
   - `contains`: PASS if value contains `value` as substring

**Evidence:**
```json
{
  "file": ".claude/agents/capo.md",
  "format": "yaml_frontmatter",
  "field": "directive_gate",
  "expected": "present",
  "found": true,
  "actual_value": "{...}"
}
```

**Gate mapping examples:**
- `gate: directive_gate block present` -> `field_check` on agent.md for `directive_gate` field
- `gate: CSP header configured` -> `field_check` on middleware config for CSP field
- `gate: domain-identified` -> `field_check` on research doc for domain heading

---

### 4. `count_match` — Count Comparison

Compares a counted value against an expected value or another counted source.

**Input:**
```yaml
evaluator: count_match
config:
  source: "glob"               # "glob" (count matching files), "json_field" (extract number), "command" (run command, parse output)
  source_config:
    pattern: ".claude/agents/*/agent.md"  # for glob
  compare: "equals"             # "equals", "gte" (>=), "lte" (<=), "gt" (>), "lt" (<)
  expected: 25                  # static number
  # OR
  expected_source: "field"     # dynamic: count from another source
  expected_config:
    file: ".claude/CLAUDE.md"
    pattern: "([0-9]+) Specialized Agents"
    group: 1
```

**Evaluation:**
1. Count from `source`:
   - `glob`: Count files matching `source_config.pattern`
   - `json_field`: Read `source_config.file`, extract `source_config.field`, parse as number
   - `command`: Run `source_config.command`, parse stdout as number
2. Get expected value:
   - If `expected` is set: use that number
   - If `expected_source` is set: count from that source using `expected_config`
3. Apply `compare` operation
4. PASS if comparison is true, FAIL if false

**Evidence:**
```json
{
  "source": "glob",
  "actual_count": 25,
  "expected_count": 25,
  "comparison": "equals",
  "result": true
}
```

**Gate mapping examples:**
- `gate: claude_md_counts_match_disk` -> `count_match` comparing glob counts to CLAUDE.md regex-extracted counts
- `gate: all assets optimized` -> `count_match` comparing raw asset count to optimized asset count

---

## Verdict Structure

Every evaluation produces a verdict:

```json
{
  "gate_name": "run-tests",
  "verdict": "PASS",
  "evaluator_type": "script_exit",
  "evidence": { ... },
  "timestamp": "2026-03-25T10:30:00Z",
  "duration_ms": 1200,
  "enforcement": "warn",
  "resolution": "auto",
  "flow_name": "code-change",
  "phase_name": "run-tests"
}
```

### Verdict Values

| Verdict | Meaning | When |
|---------|---------|------|
| `PASS` | Gate condition satisfied | Evaluator check succeeded |
| `FAIL` | Gate condition not satisfied | Evaluator check failed |
| `SKIPPED` | Gate not evaluated | Enforcement level excludes this gate, or prerequisites not met |
| `ERROR` | Evaluation itself failed | Script timeout, file not found, parse error |

### SKIPPED Logic

A gate is SKIPPED (not evaluated) when:

1. **Enforcement level excludes it**: The gate has a `levels` field and the current enforcement level is not in the list
2. **Prerequisites not met**: A preceding gate in the same phase returned FAIL or ERROR and the flow uses sequential evaluation
3. **No evaluator match**: The gate condition text does not map to any predefined evaluator type

When a gate is SKIPPED, the verdict includes the reason:

```json
{
  "verdict": "SKIPPED",
  "evidence": {
    "reason": "enforcement_level",
    "current_level": "standard",
    "required_levels": ["strict"]
  }
}
```

---

## Evaluator Selection

The gate evaluator maps gate conditions from YAML to evaluator types. This mapping is heuristic in Phase 2 -- the evaluator infers the type from the gate condition text and context.

### Mapping Rules

| Gate condition pattern | Evaluator type | Config inference |
|----------------------|----------------|-----------------|
| `*_exit_code == 0` | `script_exit` | Command from `hook_ref` or phase context |
| `*_exists` or `* exist*` | `file_exists` | Path from gate notes or condition |
| `*_match*` or `*counts*` | `count_match` | Sources from condition context |
| `*field*` or `*present*` or `*configured*` | `field_check` | File and field from condition |
| No match | `SKIPPED` | Gate cannot be auto-evaluated |

### Manual Evaluator Override

Gates can explicitly declare their evaluator type in the YAML (Phase 2+):

```yaml
gates:
  - name: run-tests
    condition: test_exit_code == 0
    evaluator:
      type: script_exit
      config:
        command: "npm test"
    on_fail: warn
    resolution: auto
```

When `evaluator` is present in the gate definition, it is used directly. No heuristic mapping is needed.

---

## Enforcement Behavior

The gate evaluator produces verdicts. The enforcement engine acts on them.

| Enforcement | On PASS | On FAIL | On SKIPPED | On ERROR |
|-------------|---------|---------|------------|----------|
| `block` | Continue | HALT execution. Report failure. Do not proceed. | Continue (gate not applicable) | HALT execution. Report error. |
| `warn` | Continue | Continue. Emit warning to stderr. | Continue | Continue. Emit error to stderr. |
| `log` | Continue | Continue. Record in pipeline log only. No output. | Continue | Continue. Record in log. |

### BLOCK Halt Behavior

When a gate with `on_fail: block` returns a FAIL verdict:

1. **Pipeline execution halts immediately.** The current pipeline step does not proceed. No further skills are invoked. No further gates in the same step are evaluated (they are marked SKIPPED with reason `blocked_by_prior`).

2. **Structured halt message is emitted to the user:**

```
BLOCKED: Gate "{gate_name}" failed.
Flow:    {flow_name} ({flow_kind})
Phase:   {phase_name}
Step:    {pipeline_step}

FAILURE:
  Condition: {gate condition text}
  Evidence:  {evidence summary from evaluator}

TO RESOLVE:
  1. Fix the underlying issue and re-run the pipeline step
  2. Override with --force-proceed (logged in audit trail)
  3. Downgrade enforcement: change on_fail to "warn" in the flow YAML

Execution halted. No further pipeline steps will run until this gate passes.
```

3. **Pipeline state is updated** with the blocked status:

```json
{
  "skill": "teo-build",
  "status": "blocked",
  "blocked_by": {
    "gate_name": "no-critical-findings",
    "verdict": "FAIL",
    "evidence": { ... },
    "timestamp": "ISO8601"
  }
}
```

4. **Pipeline log entry is written** with `event_type: "gate_check"` and `verdict: "FAIL"` and `metadata.action: "blocked"`.

### BLOCK Override Mechanism

Users can force-proceed past a BLOCK gate using `--force-proceed`. This is an explicit escape hatch for situations where the gate failure is a known acceptable risk.

**Override behavior:**

1. User invokes `--force-proceed` (or natural language equivalent: "force proceed", "override", "skip this gate")
2. The gate verdict remains FAIL — the override does not change the evaluation result
3. An override record is appended to the gate audit trail:

```json
{
  "gate_name": "no-critical-findings",
  "verdict": "FAIL",
  "override": {
    "type": "force-proceed",
    "timestamp": "ISO8601",
    "session_id": "capo-2026-03-25-001",
    "rationale": "User override: --force-proceed"
  },
  "enforcement_action": "overridden"
}
```

4. Pipeline execution resumes from the blocked step
5. The override is logged in the pipeline log with `metadata.action: "overridden"`
6. The teo-audit report includes all overrides in a dedicated "Overrides" section

**Override is NOT silent.** Every override produces a visible log entry. There is no way to bypass a BLOCK gate without leaving an audit record. This is by design — compliance requires evidence that bypasses were intentional and acknowledged.

### Gate Skip Auditor

Every gate skip must be logged with a rationale. Silent skips are a compliance violation.

**When a gate is skipped, the skip record includes:**

```json
{
  "gate_name": "owasp-assessed",
  "verdict": "SKIPPED",
  "skip_reason": "enforcement_level | blocked_by_prior | human_gate | no_evaluator | user_modifier",
  "rationale": "Human-readable explanation of why this gate was skipped",
  "timestamp": "ISO8601",
  "session_id": "capo-2026-03-25-001"
}
```

**Skip reasons:**

| Reason | Description | Audit Risk |
|--------|-------------|-----------|
| `enforcement_level` | Gate not applicable at current enforcement level | Low |
| `blocked_by_prior` | A prior BLOCK gate failed, remaining gates skipped | Low (expected) |
| `human_gate` | Gate requires human input, not auto-evaluable | Low |
| `no_evaluator` | Gate condition does not map to any predefined evaluator | Medium — may indicate a gap |
| `user_modifier` | User explicitly requested skipping (e.g., "skip review") | High — override logged |

**Skip audit in teo-audit:** The `teo-audit` report includes a "Gate Skips" section listing all skipped gates, their reasons, and whether the skip represents an audit risk. Gates skipped by `user_modifier` are flagged for compliance review.

### Enforcement Precedence

1. **Step-level `on_fail`** overrides flow-level `enforcement` for that specific gate
2. **Flow-level `enforcement`** is the default for all gates in the flow
3. **Verification level** (`strict`/`standard`/`light`) controls which gates are evaluated at all

---

## Observability

Every gate evaluation writes to the pipeline log (`.claude/memory/capo-pipeline-log.json`):

```json
{
  "event_type": "gate_check",
  "timestamp": "2026-03-25T10:30:00Z",
  "session_id": "capo-2026-03-25-001",
  "pipeline_step": "run-tests",
  "gate_result": "PASS",
  "verdict": "PASS",
  "metadata": {
    "evaluator_type": "script_exit",
    "flow_name": "code-change",
    "phase_name": "run-tests",
    "enforcement": "warn",
    "resolution": "auto",
    "evidence": { "command": "npm test", "exit_code": 0 }
  }
}
```

### Debug Mode Output

When `debug: true`:

```
[DEBUG] Gate Evaluator — {gate_name}
[DEBUG]   Flow: {flow_name}
[DEBUG]   Phase: {phase_name}
[DEBUG]   Evaluator: {evaluator_type}
[DEBUG]   Config: {config_summary}
[DEBUG]   Evidence: {evidence_summary}
[DEBUG]   Verdict: {PASS|FAIL|SKIPPED|ERROR}
[DEBUG]   Enforcement: {block|warn|log}
[DEBUG]   Action: {continued|halted|warned|logged}
```

---

## Gate Classification

All gate evaluator operations are classified as `resolution: auto`:

| Gate | Resolution | Rationale |
|------|------------|-----------|
| script_exit evaluation | auto | Exit code comparison |
| file_exists evaluation | auto | File system check |
| field_check evaluation | auto | File content check |
| count_match evaluation | auto | Numeric comparison |
| Evaluator selection | auto | Heuristic mapping |
| Enforcement action | auto | Rule-based behavior |

Human-resolution gates (`resolution: human`) are never auto-evaluated. When the evaluator encounters a gate with `resolution: human`, it returns SKIPPED with reason `human_gate` and Capo presents the gate to the user per the escalation format in `gate-classification-protocol.md`.

---

## Integration with Existing Hooks

Phase 2 does not replace Phase 1 hooks. Both run:

- **Phase 1 hooks** (`task-completed.sh`): Continue to fire on TaskCompleted events. They implement the same checks as the gate evaluator but in shell.
- **Phase 2 gate evaluator**: Fires during Capo pipeline execution. Capo reads gate definitions from the registry and evaluates them.

The two layers are complementary:
- Hooks catch issues when agents complete tasks (any agent, any task)
- The gate evaluator catches issues during orchestrated pipeline execution (Capo-managed work)

When Phase 2 is mature and validated, hooks can be refactored to read from YAML instead of hardcoded logic. This migration is tracked separately and is NOT part of M2.
