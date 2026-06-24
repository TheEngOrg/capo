# TEO E2E Sandbox — Pre-v0.1.0-alpha Validation

This sandbox is the manual + semi-automated E2E validation gate before the first public TEO release. It verifies that a locally installed TEO plugin correctly routes prompts through the Capo pipeline, writes pipeline state, and modifies files as directed.

Run these steps **in order**. Each step's expected output is listed so you know it passed without ambiguity.

---

## STEP-1-INSTALL

**Who runs it:** Brodie (manual)

**Command:**
```bash
bash scripts/verify-plugin-install.sh
```

**Expected pass output:**
```
OK: Agents (21) confirmed
OK: Skills (15) confirmed
OK: Hooks (6 event types) confirmed
✔ PASS: teo plugin install verified
```

**On failure:** The plugin manifest or asset files are out of sync with the install gate. Re-run `claude plugin install` from the marketplace.json source and check that agents are flat `.md` files under `.claude/agents/` (not nested directories). Refer to the `Plugin agents MUST be flat files` behavioral rule.

---

## STEP-2-VALIDATE

**Who runs it:** Autonomous (run `bash sandbox/scripts/validate-plugin.sh` to confirm)

**Command:**
```bash
bash sandbox/scripts/validate-plugin.sh
```

**Expected pass output:**
```
PASS: claude CLI found
PASS: jq found
PASS: claude plugin validate passed
PASS: plugin.json has required field: name
PASS: plugin.json has required field: version
PASS: plugin.json has required field: skills
PASS: plugin.json has required field: hooks
PASS: plugin.json does not have 'agents' field
PASS: agent count == 21
PASS: skill count == 15
PASS: all checks passed
```

**On failure:** Each check prints its own `FAIL:` line describing what is missing. Fix the named asset or manifest field and re-run.

---

## STEP-3A-RUN-MECHANICAL

**Who runs it:** Brodie (manual — type into a Claude Code session with TEO installed)

**Command (type verbatim into Claude Code chat):**
```
/teo fix the typo in sandbox/fixtures/broken-readme.md
```

**Expected pass output:** Capo pipeline fires. The Dispatcher routes on the Tier-1 `/teo *` trigger. A MECHANICAL workstream is classified and dev agent edits `sandbox/fixtures/broken-readme.md`, replacing "teh" with "the". After the task completes:

- `.claude/memory/pipeline/capo-result.json` exists
- `sandbox/fixtures/broken-readme.md` no longer contains the string "teh "

**On failure:** If `capo-result.json` is not written, the pipeline did not fire. Confirm the TEO plugin is installed (`claude plugin list`) and the Dispatcher CLAUDE.md is active in this session. Check `.claude/memory/traces/` for error output.

---

## STEP-3B-RUN-ARCHITECTURAL

**Who runs it:** Brodie (manual — type into a Claude Code session with TEO installed)

**Command (type verbatim into Claude Code chat):**
```
teo plan add a health-check endpoint to the sandbox
```

**Expected pass output:** Capo pipeline fires on the Tier-1 `teo plan *` trigger. Capo routes this as an ARCHITECTURAL workstream (plan-only, no code written). After the task completes:

- `.claude/memory/pipeline/capo-result.json` is updated
- Either `.claude/memory/plans/` contains at least one file, OR `capo-result.json` has a `pipeline_phase` field containing the substring `plan`
- `capo-result.json.completed_steps` contains at least one entry referencing a planning activity

**On failure:** If pipeline does not fire, confirm the message starts with `teo plan` (Tier-1 table match is case-insensitive). If pipeline fires but no plan artifact appears, check `.claude/memory/traces/` for Capo output.

> **Note:** STEP-3A and STEP-3B overwrite the same `capo-result.json`. Run STEP-4 between them if you want to capture STEP-3A state separately.

---

## STEP-4-VERIFY-TRACES

**Who runs it:** Autonomous (run after STEP-3A)

**Command:**
```bash
bash sandbox/scripts/verify-traces.sh
```

**Expected pass output:**
```
PASS: capo-result.json exists
PASS: capo-result.json is valid JSON
PASS: capo-result.json has 'status' field
PASS: completed_steps is non-empty
PASS: fixture file was modified
PASS: typo 'teh' is absent from fixture
WARN: no workstream state files found outside pipeline/ (best-effort check)  [or omitted if files exist]
NOTE: HMAC ledger not checked — runtime engine not wired to plugin path
PASS: all E2E trace checks complete
```

**On failure:** Each check prints its own `FAIL:` line. The most common cause is running STEP-4 before STEP-3A — the script will exit 1 with `FAIL: capo-result.json missing — run STEP-3A first`.

---

## Known Limitations

**HMAC signed ledger is NOT verified.** `src/core` and `src/engine` (the deterministic guardrails, gate runner, and signed audit ledger) are not wired to the plugin execution path. The post-tool-use and task-completed hooks are stubs that exit 0. `verify-traces.sh` explicitly skips ledger checks and prints a note explaining this. Tracked in the TEO Roadmap — the runtime must be wired before the ledger assertion can become a gate.

**STEP-3A and STEP-3B overwrite the same `capo-result.json`.** If you need to validate both states independently, run STEP-4 after STEP-3A before running STEP-3B.

**STEP-3B pass criteria use OR conditions** (`plans/` directory OR `pipeline_phase` field). Capo's plan output path is not fully deterministic — either evidence form is acceptable.

**`validate-plugin.sh` requires the `claude` CLI binary on PATH.** If the CLI is not found, the script exits 1 with `FAIL: claude CLI not found`.

**STEP-4 Check 7 (workstream state file) is a WARN not a FAIL.** Capo may legitimately write only to `pipeline/` for short tasks.

**These tests verify the v0.1.0-alpha install path** (`marketplace.json` source: `{ "source": "github", "repo": "TheEngOrg/capo" }`). WS-GO-07-swap is complete — the GitHub source is the committed form. Run `scripts/verify-plugin-install.sh` and get a PASS before tagging any release.
