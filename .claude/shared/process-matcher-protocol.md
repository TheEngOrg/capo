# Process Matcher Protocol

## Purpose

The Process Matcher is the mechanism Capo uses to match incoming requests against registered process flows. It sits between intent classification and pipeline composition in Capo's intake flow:

```
Intake -> Research Gate -> Classify Intent -> Process Match -> Compose Pipeline + Flow -> Execute
```

When Capo classifies intent, the matcher determines which registered flow (if any) should govern execution. If no flow matches, Capo falls back to the planning-spike flow for discovery.

---

## Matching Algorithm

### Step 1: Load Flow Registry

Read all YAML files from:
- `.claude/processes/atomic/*.yaml` -- atomic flows
- `.claude/processes/composed/*.yaml` -- composed flows

For each file, extract:
- `name` -- flow identifier
- `kind` -- atomic or composed
- `trigger.condition` -- human-readable trigger description
- `trigger.patterns` -- file glob patterns (if present)
- `trigger.keywords` -- keyword list (if present)
- `enforcement` -- block / warn / log

Build the registry as a list of `{name, kind, trigger, enforcement, path}` entries. Composed flows are checked first (they represent full workflows). Atomic flows are checked second (they represent individual process steps).

### Step 2: Score Each Flow

For each flow in the registry, compute a match score based on these signals. Each signal contributes a weight; the total determines confidence.

| Signal | Weight | Description |
|--------|--------|-------------|
| **Explicit declaration** | 100 | User says "/teo build website" and a flow named "website-project" exists |
| **Trigger keyword match** | 30 per keyword | Words in user request match `trigger.keywords` or words in `trigger.condition` |
| **File type match** | 20 per pattern | Files being touched match `trigger.patterns` globs |
| **Project marker match** | 40 | Project markers (package.json with astro -> website-project) detected |
| **Workstream resume** | 100 | Existing workstream in memory references this flow |
| **Intent alignment** | 10 | Flow's typical intent matches the classified intent |

**Scoring thresholds:**

| Score | Confidence | Action |
|-------|------------|--------|
| >= 80 | HIGH | Load matched flow directly |
| 30-79 | MEDIUM | Present candidate flows to user for confirmation |
| < 30 | LOW | No match -- fall back to planning-spike |

### Step 3: Return Match Result

The matcher returns one of three results:

1. **Matched flow** (HIGH confidence) -- a single flow with score >= 80
   - Capo loads this flow and uses it to govern pipeline execution
   - Log: `process_match: {flow: "name", confidence: "high", score: N}`

2. **Candidate flows** (MEDIUM confidence) -- one or more flows with scores 30-79
   - Capo presents candidates to the user:
     > "I found process flows that may apply: [list]. Which should I follow, or should I run a planning spike to figure it out?"
   - Log: `process_match: {candidates: ["name1", "name2"], confidence: "medium"}`

3. **No match** (LOW confidence) -- all flows scored below 30
   - Capo falls back to the planning-spike flow
   - Log: `process_match: {flow: "planning-spike", confidence: "low", reason: "no registered flow matched"}`

---

## Matching Signals — Details

### Explicit Declaration

The user explicitly names a project type or flow:
- "/teo build website" -> match "website-project"
- "/teo run security review" -> match "security-review"
- "/teo planning spike" -> match "planning-spike" directly

This is the highest-confidence signal. If present, it short-circuits scoring.

### Trigger Keywords

Extract keywords from `trigger.condition` and `trigger.keywords` for each flow. Match against the user's request text (case-insensitive, word boundary).

Example: `website-project` has condition text containing "website", "site", "web", "astro", "frontend". A request containing "build me a website" matches on "website".

### File Type Match

If the request references specific files or the workstream has files in scope, match against `trigger.patterns` globs.

Example: Files with `.astro` extension match `website-project` (which composes flows with `**/*.astro` patterns).

### Project Markers

Detect project type from configuration files:
- `package.json` with `astro` dependency -> website project
- `package.json` with `express` or `fastify` -> API project
- `package.json` with `next` -> Next.js project
- `Cargo.toml` -> Rust project
- `go.mod` -> Go project
- `pyproject.toml` or `requirements.txt` -> Python project
- `docker-compose.yml` -> containerized project

Project markers provide context even when the user doesn't specify a project type.

### Workstream Resume

Check `.claude/memory/workstream-*-state.json` for active workstreams. If a workstream references a registered flow, resume it.

```json
{
  "workstream_id": "WS-42",
  "process_flow": "website-project",
  "current_phase": "build"
}
```

This is an exact match -- no scoring needed.

### Intent Alignment

Cross-reference the classified intent (PLAN, BUILD, FIX, REVIEW, IMPROVE, SHIP) with the flow's typical usage:
- PLAN -> project-planning, planning-spike
- BUILD -> website-project, code-change
- FIX -> code-change
- REVIEW -> security-review, design-review
- SHIP -> documentation-update

---

## Alignment Check Algorithm

After the process matcher returns a result and intent classification completes (in parallel), Capo checks whether the matched flow and classified intent are aligned.

### What "Alignment" Means

A matched flow and classified intent are **aligned** when the flow's phase set contains phases that support the classified intent. The mapping:

| Intent | Required Phase Coverage |
|--------|------------------------|
| PLAN | At least one of: research, planning-docs, scope, leadership-review |
| BUILD | At least one of: build-phase gates, code-change phases, implementation steps |
| FIX | At least one of: code-change phases (run-tests, lint) |
| REVIEW | At least one of: review-phase gates, screenshot-comparison, security check |
| IMPROVE | At least one of: code-change phases, review phases |
| SHIP | At least one of: documentation phases, asset phases |

**Alignment passes** when the flow contains at least one phase from the intent's required set. **Alignment fails** when the flow has zero overlap with the intent's required phases.

**Example — aligned:** User says "build me a website." Process matcher returns `website-project` (composed flow with planning, design, build, review, security, ship phases). Intent classified as BUILD. The flow has build-phase gates → aligned.

**Example — misaligned:** User says "review this code." Process matcher returns `asset-pipeline` (no review phases). Intent classified as REVIEW. The flow has no review-phase gates → misaligned.

### Re-Match Procedure (Cycle 2)

When Cycle 1 produces a misalignment, Cycle 2 re-evaluates with additional context. Here is what changes:

1. **Additional scoring signal for re-match:** The Cycle 1 intent is added as a scoring signal. Flows that support the classified intent receive a +20 bonus (`intent_alignment_boost`). Flows that were matched in Cycle 1 but misaligned receive a -10 penalty (`misalignment_penalty`).

2. **Re-classification context:** The intent classifier receives the Cycle 1 match result. If the matched flow strongly suggests a different intent (e.g., planning flow matched but BUILD was classified), the classifier re-evaluates with the flow's typical intent as a competing hypothesis.

3. **Pinned prompt re-read:** Both re-match and re-classify read the pinned original prompt (never a summary). This prevents drift from accumulated context.

4. **Changed thresholds:** None. The scoring thresholds (HIGH >= 80, MEDIUM 30-79, LOW < 30) remain the same. Only the input signals change.

### Escalation Format

When both cycles fail to align, Capo presents a structured decision prompt to the user. The escalation includes:

```
1. Pinned prompt (raw, unmodified user input)
2. Cycle 1 results:
   - Matched flow name and confidence score
   - Classified intent and signals used
   - Mismatch reason (which required phases were missing)
3. Cycle 2 results:
   - Re-matched flow name and confidence score
   - Re-classified intent and signals used
   - Mismatch reason (which required phases were still missing)
4. Options:
   a. Override: proceed with the best-scoring flow + best intent (user accepts the mismatch)
   b. Clarify: user rephrases the request (new pinned prompt, restart from step 6)
   c. Spike: activate planning-spike flow to discover the right process
   d. Ad-hoc: proceed without a registered flow (pipeline template only)
```

The escalation is classified as `resolution: human` — execution pauses until the user responds.

---

## Integration with Pipeline Composition

After the matcher returns a result:

1. **HIGH confidence match on a composed flow:**
   - Capo uses the composed flow's `phase_order` and `composes` list to build the pipeline
   - Each phase maps to atomic flow gates that must be satisfied
   - The pipeline template (from intent classification) is augmented with flow-specific gates

2. **HIGH confidence match on an atomic flow:**
   - The atomic flow's phases are added as gates within the existing pipeline template
   - The flow does not replace the pipeline -- it adds enforcement to specific steps

3. **MEDIUM confidence (candidates):**
   - Wait for user confirmation before loading any flow
   - If user selects a flow, proceed as HIGH confidence
   - If user says "none", fall back to planning-spike

4. **LOW confidence (no match):**
   - Load the planning-spike flow
   - After the spike completes, re-run the matcher with enriched context
   - If the spike produces a new composed flow, the matcher will find it next time

---

## Re-Matching After Spike

When a planning-spike completes and registers a new flow:

1. The spike writes the new flow to `.claude/processes/composed/{name}.yaml`
2. Capo re-runs the matcher with the original request context
3. The new flow should now match at HIGH confidence
4. Proceed with pipeline composition using the new flow

This is the learning loop: each completed spike teaches the system a new pattern.

---

## Process Matcher in Capo's Intake Flow

Updated intake flow (Step 5 is new):

```
1. Receive prompt from /teo gateway
2. Create or load teo-project-context for the initiative
3. Assess scope: What domains are involved?
4. RESEARCH GATE -- before any C-Suite or skill invocation
5. PROCESS MATCH -- match request against registered flows
   5a. Load flow registry from processes/atomic/ and processes/composed/
   5b. Score each flow against request context
   5c. Return: matched flow, candidate flows, or no match
   5d. If no match: activate planning-spike flow
6. Classify intent and compose pipeline (informed by matched flow)
7. Execute pipeline -- invoke skills in sequence, enforce gates
8. Monitor execution, enforce gates, manage sessions
```

---

## Debug Output (TEO_DEBUG Mode)

When debug mode is active (`debug: true` in the Capo intake), the process matcher produces verbose output for every flow it evaluates. This output goes to both console (stderr) and `.claude/memory/traces/debug-log.json`.

### What the Matcher Logs

**For every flow in the registry:**
- Flow name, kind (atomic/composed), enforcement level
- Each scoring signal: name, weight contributed, matched value
- Total score and resulting confidence level

**For rejected flows (score < 30):**
- Why the flow was rejected (which signals did not match)
- What the flow would have needed to match (missing keywords, patterns, markers)

**Final ranking:**
- All flows sorted by score (descending)
- The selected flow (or "no match" / "candidates presented to user")

### Debug Trace Entry

Each matcher invocation writes one entry to the debug log:

```json
{
  "timestamp": "ISO8601",
  "session_id": "capo-{date}-{seq}",
  "gate": "process-match",
  "enforcement": "standard",
  "resolution": "auto",
  "input": "registry_size={N} request_summary={first 100 chars}",
  "result": "PASS | SKIPPED",
  "duration_ms": 150,
  "action": "logged",
  "source": "capo",
  "metadata": {
    "registry_size": 7,
    "scores": [
      {"flow": "website-project", "score": 90, "signals": {"explicit_declaration": 100, "project_marker": 40}},
      {"flow": "code-change", "score": 20, "signals": {"file_type_match": 20}}
    ],
    "rejected": [
      {"flow": "asset-pipeline", "score": 5, "reason": "no keyword, file type, or marker match"}
    ],
    "result_type": "matched | candidates | no_match",
    "matched_flow": "website-project",
    "confidence": "high"
  }
}
```

### Console Output Format

```
[DEBUG] Process Matcher — scoring {N} flows
[DEBUG]   Flow: website-project (composed, enforcement: block)
[DEBUG]     explicit_declaration: 100 (keyword: "website")
[DEBUG]     trigger_keyword: 0
[DEBUG]     file_type_match: 0
[DEBUG]     project_marker: 40 (astro in package.json)
[DEBUG]     workstream_resume: 0
[DEBUG]     intent_alignment: 10
[DEBUG]     TOTAL: 150 → HIGH
[DEBUG]   Flow: code-change (atomic, enforcement: warn)
[DEBUG]     explicit_declaration: 0
[DEBUG]     trigger_keyword: 0
[DEBUG]     file_type_match: 20 (*.ts matched)
[DEBUG]     project_marker: 0
[DEBUG]     workstream_resume: 0
[DEBUG]     intent_alignment: 0
[DEBUG]     TOTAL: 20 → LOW (rejected)
[DEBUG]   ---
[DEBUG]   Rejected: code-change (score 20 < 30)
[DEBUG]   Rejected: asset-pipeline (score 5 < 30)
[DEBUG]   Final: website-project (150, HIGH) — matched
```

---

## Observability

Log all match results to the pipeline log (`.claude/memory/capo-pipeline-log.json`):

```json
{
  "event_type": "process_match",
  "timestamp": "ISO8601",
  "session_id": "capo-{date}-{seq}",
  "workstream_id": "WS-{id}",
  "registry_size": 7,
  "scores": [
    {"flow": "website-project", "score": 90, "signals": ["explicit_declaration", "project_marker"]},
    {"flow": "code-change", "score": 20, "signals": ["file_type_match"]}
  ],
  "result": "matched",
  "matched_flow": "website-project",
  "confidence": "high"
}
```
