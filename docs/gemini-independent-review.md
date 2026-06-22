# Gemini Independent Review: "Deterministic Team Framework" Evaluation

**Date:** June 21, 2026  
**Auditors:** L7 Adversarial Review Board (Systems Architecture, Platform & Routing, Reliability & Security)  
**Subject:** Deterministic Team Framework (TEO Orchestration, Gate Evaluator, Handoff & Error Recovery Protocols)  
**Status:** Under Review (Targeting v1.0.0 Readiness)

---

## Executive Summary

This independent review evaluates the structural integrity, security, and orchestrational validity of the **The Engineering Org (TEO)** plugin, specifically focusing on the claim of being a **"Deterministic Team Framework"**. 

In an ecosystem where AI agent orchestrators are notoriously probabilistic, fragile, and prone to unconstrained conversational drift, TEO attempts to impose deterministic rigor via:
1. **Stateless Gate Evaluators** utilizing hard-coded POSIX checks.
2. **Atomic GO-Signal Protocols** forcing structured state synchronization.
3. **Formalized Handoff Envelopes** enforcing depth caps and loop prevention.
4. **HMAC-Signed Audit Ledgers** ensuring complete non-repudiation of agent activity.

**Verdict:** The framework successfully establishes a **"Deterministically Gated"** environment. It manages state transitions with exceptional rigor. However, the system's "determinism" remains highly contingent on LLM compliance with schemas and prompt constraints. True determinism requires the runtime to actively enforce limits (e.g., reverting files, blocking unknown configurations) rather than delegating validation back to the probabilistic agent.

Below is the multi-angle adversarial teardown and action plan required for v1.0.0 production readiness.

---

## 1. Systems Architecture Evaluation (L7 Systems Architect)
*Focus: State Management, Concurrency, and True Determinism*

### What is Done Right
* **Stateless Deterministic Gates:** The core gate evaluation mechanics (`script_exit`, `file_exists`, `field_check`, `count_match`) are decoupled from AI opinions. They verify objective realities on the file system and process trees, ensuring agent claims are empirically verified.
* **Go-Signal Coordination:** Moving coordination out of natural language into atomic file writes (`.claude/memory/go-signals/<workstream_id>-<phase>.json`) with schema versioning is an industry-grade distributed systems pattern. It eliminates "false positive completions."
* **Commit Lock Coordination:** Using `.claude/scripts/teo-commit-lock` with a 90-second TTL prevents split-brain git index states during parallel dev/QA spawns.

### Critical Vulnerabilities & Gaps
* **Heuristic Parser Fragility:** The gate evaluator maps conditions using regex-style heuristics (e.g., matching `*_exit_code == 0` to `script_exit`). Heuristics introduce non-determinism at the parsing layer.
* **The "Revert to Green" Assumption:** `error-recovery.md` relies on the agent executing a revert during `LOGIC` failures. If an agent fails or enters a hallucination loop, the codebase is left in a dirty, broken state.
* **Lack of Isolation:** Agents operate directly on the user's workspace directory. A runaway agent at Depth 3 can corrupt codebases because there is no containerization or sandboxed file-system abstraction.

---

## 2. Platform & Developer Experience Evaluation (L7 Platform Lead)
*Focus: "Team" Coordination, Routing Protocols, and Usability*

### What is Done Right
* **Strict Depth Boundary:** Hard-capping depth to 3 prevents infinite recursive loops of agents delegating tasks to other agents.
* **Consultation vs. Delegation:** Separating consultations (information gathering) from delegations (task ownership transfer) matches human organizational behavior and optimizes context tokens (bypassing loop checks and not incrementing the depth tree).
* **Protected-Path Shielding:** Blocking direct write access to `.claude/scripts/**` and `.claude/shared/**` via `pre-edit-write-guard.sh` prevents the team of agents from editing their own core protocols mid-flight.

### Critical Vulnerabilities & Gaps
* **Context Decay (The Telephone Game):** The hard limit of 500 tokens for `context.essential` means critical requirements are systematically shed as the delegation chain moves from Depth 1 to Depth 3.
* **Partial Status Poisoning:** Returning `status: partial` when an agent hits a depth limit allows the parent agent to proceed on incomplete assumptions.
* **Lack of Schema Validation on Envelopes:** The handoff format relies on prompt-enforced YAML. If the LLM generates slightly invalid YAML or omits fields, the parser throws a runtime exception rather than a graceful, typed protocol error.

---

## 3. Reliability & Security Evaluation (L7 Security/SRE)
*Focus: Error Recovery, Resilience, and Auditability*

### What is Done Right
* **HMAC-Signed Ledgers:** Signing the ledger prevents unauthorized local tampering. If a developer or a rogue agent attempts to alter the audit trail in `capo-pipeline-log.json`, the cryptographic verification fails.
* **Defensive Error Taxonomy:** Categorizing errors into `TRANSIENT`, `RESOURCE`, `LOGIC`, `PERMISSION`, and `FATAL` ensures that actions match failure modes (e.g., never retrying permissions; halting immediately on fatals).
* **Defensive Gate Enforcement:** Setting gates to `on_fail: block` forces a hard stop on failures, demanding a highly visible and logged manual `--force-proceed` override.

### Critical Vulnerabilities & Gaps
* **The Self-Diagnosis Trap:** The framework requires the agent to classify its own errors. Under high load or when executing flawed logic, agents are prone to misclassifying `FATAL` corruption as `TRANSIENT` issues, leading to recursive destructive retries.
* **Default-Skip Security Bypass:** The `Gate Skip Auditor` marks undefined gates as `SKIPPED (no_evaluator)`. This is a massive compliance risk; any prompt-injection or syntax error in a gate definition results in it being skipped silently instead of throwing a validation block.
* **TTL Starvation:** The 90-second commit lock TTL assumes commands run in low-latency environments. On heavy builds, git locks could expire mid-operation, leading to concurrency collisions.

---

## Action Plan for v1.0.0 Production Readiness

To confidently market and run TEO as a **Deterministic Team Framework**, the following three mitigation layers must be implemented in the core engine (`src/core/` and `src/engine/`):

### Phase 1: Hardened Environment Control (Immediate)
1. **Automated Git Snapshots:** Before dispatching any phase to a `dev` or `qa` agent, the orchestration engine must automatically execute a git stash or create a temporary branch. If a `LOGIC` or `FATAL` error is hit, the *framework* must programmatically revert the branch to the pre-dispatch snapshot.
2. **Defensive Parser Validation:** Wrap all incoming Handoff Envelopes in a strict parser (e.g., `Zod` schema validation in `validate.ts`). If the LLM returns an invalid envelope, throw a structured `INVALID_ENVELOPE` error immediately before invoking any agent.

### Phase 2: Secure Defending Defaults (Security)
3. **Default-Deny Gate Evaluation:** Eliminate heuristic fallback skips. If a gate condition cannot be mapped to a known evaluator, it must fail-closed, yielding an `ERROR` / `BLOCK` verdict, rather than being marked `SKIPPED`.
4. **Independent Audit Validation:** Compile a standalone `teo-audit` CLI tool that runs in CI/CD, cryptographically verifying the HMAC ledger and flagging all `user_modifier` or `no_evaluator` skips for human security review.

---

### Conclusion

The TEO framework possesses the foundational architecture to back up its claim of being a **Deterministic Team Framework**. By moving from *agent-guided* state-tracking to *runtime-enforced* environment stashing, strict schema checking, and default-closed gates, the framework can bridge the gap from a highly disciplined prototype to an enterprise-grade agent orchestration runtime.
