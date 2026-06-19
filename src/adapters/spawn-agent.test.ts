// =============================================================================
// spawn-agent.test.ts — Passing specs for spawnAgent (WS-P1-05, LLM call site #2)
//
// This file is the authoritative specification for the AgentSpawner seam and
// ClaudeCodeAdapter.spawnAgent(). All 35 tests PASS at gate-2 (implementation complete).
// Implementation lives in src/adapters/claude-code.ts.
//
// ============================================================================
// CONTRACT: AgentSpawner + ClaudeCodeAdapter.spawnAgent()
// ============================================================================
//
// SEAM: AgentSpawner (injected into ClaudeCodeAdapter — distinct from AgentRunner)
//
//   interface AgentSpawnRequest {
//     agentDefinition: AgentDefinition;  // the loaded agent definition (includes body, role, disallowedTools_default)
//     prompt: string;                    // task.prompt verbatim
//     disallowedTools: string[];         // union of agent.disallowedTools_default + task.disallowedTools
//     timeoutMs: number;                 // context.stepTimeoutMs verbatim
//   }
//
//   interface AgentSpawnRaw {
//     output: string;      // the agent's raw text output, which must contain a VERDICT block
//     errored?: boolean;   // optional: spawner sets true on soft errors (output still present)
//   }
//
//   interface AgentSpawner {
//     spawn(req: AgentSpawnRequest): Promise<AgentSpawnRaw>;
//   }
//
// CONSTRUCTOR INJECTION (new field on ClaudeCodeAdapterOptions):
//
//   interface ClaudeCodeAdapterOptions {
//     runner: AgentRunner;        // existing — drives sagePlan
//     spawner: AgentSpawner;      // NEW — REQUIRED for spawnAgent; CI mocks; prod wires real spawn
//     agentsDir?: string;         // existing — roster isolation (forwarded to loadAgentDefinition)
//     maxRounds?: number;         // existing — sagePlan round cap
//   }
//
//   NOTE: `spawner` is required so callers cannot accidentally omit it and get silent
//   failure. If `spawner` is omitted, TypeScript compilation fails.
//
// VERDICT PARSING RULES (critical-path; fail-safe):
//
//   spawnAgent() parses a structured VERDICT block from spawner output using a
//   regex — no LLM judging. The parser applies these rules in order:
//
//   1. If spawner rejects/throws          → BLOCKED ("BLOCKED: spawner error: <msg>")
//   2. If spawner returns { errored:true }
//      and output has no parseable VERDICT → BLOCKED ("BLOCKED: spawner errored and no verdict")
//   3. Scan output for /^VERDICT:\s*(PASS|FAIL)\s*$/m (case-sensitive, full-word):
//      a. Exactly one "VERDICT: PASS" found, no "VERDICT: FAIL" → status "PASS"
//      b. Exactly one "VERDICT: FAIL" found, no "VERDICT: PASS" → status "FAILED"
//      c. Both "VERDICT: PASS" AND "VERDICT: FAIL" found (conflict) → BLOCKED
//         ("BLOCKED: conflicting verdicts in output")
//      d. Neither found (no verdict) → BLOCKED ("BLOCKED: no verdict in output")
//      e. Garbage/partial text that does not match → BLOCKED (same as d)
//
//   BLOCKED representation in StepResult:
//     { taskId: task.id, status: "FAILED", detail: "BLOCKED: <reason>" }
//
//   KEY INVARIANT: A missing, unparseable, or conflicting verdict is NEVER mapped
//   to status "PASS". The fail-safe always maps to "FAILED" with a detail starting
//   "BLOCKED:". Callers can detect BLOCKED by checking:
//     result.status === "FAILED" && result.detail?.startsWith("BLOCKED:")
//
// spawnAgent(task, context) BEHAVIOR:
//
//   1. If task.type !== "AGENT" → return BLOCKED with detail
//      "BLOCKED: spawnAgent called with non-AGENT task type: <type>"
//
//   2. Load agent definition via loadAgentDefinition(task.agent_id, agentsDir).
//      If unknown (throws) → return BLOCKED with detail
//      "BLOCKED: unknown agent id: <agent_id>"
//      NOTE: does NOT throw — wraps the error fail-safe.
//
//   3. Build AgentSpawnRequest:
//      - agentDefinition: the loaded AgentDefinition
//      - prompt: task.prompt
//      - disallowedTools: union of agentDef.disallowedTools_default + (task.disallowedTools ?? [])
//        (order: agent defaults first, then task overrides; deduplication not required but allowed)
//      - timeoutMs: context.stepTimeoutMs
//
//   4. Call spawner.spawn(req). If it throws/rejects → BLOCKED, do NOT propagate.
//
//   5. Parse verdict from raw.output per the rules above. Return StepResult.
//
//   6. Echo task.id as taskId in every returned StepResult.
//
// EMPTY PROMPT:
//   An AGENT task with an empty prompt is valid per schema (AgentTaskSchema requires
//   prompt: z.string().min(1), so the task itself would not parse). However, if a
//   task reaches spawnAgent with a non-empty prompt (as guaranteed by the schema),
//   the spawner is still called. A non-empty-ish but whitespace-only prompt is
//   passed through unmodified — spawnAgent does not validate prompt content.
//
// disallowedTools UNION:
//   Union is set-union of agent's disallowedTools_default + task.disallowedTools.
//   If agent defines ["Write","Edit"] and task adds ["Bash"], the request receives
//   all three. Order is not specified; assert all members present.
//   Deduplication is optional (duplicates are harmless), but the union must be a superset.
//
// MODEL-FREE:
//   All tests use an injected mock AgentSpawner. No real network/model calls.
//   Integration tests (real Claude Code spawn) go in spawn-agent.integration.test.ts
//   gated behind INTEGRATION_TESTS env var.
//
// ============================================================================
// TEST ORDER: misuse → boundary → golden (ADR-064 critical-path policy)
// ============================================================================

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AgentDefinition } from "../agents/load.js";
import type { TEOTask } from "../core/plan.js";
import type { AgentContext } from "./types.js";

// ---------------------------------------------------------------------------
// Module under test — implementation complete (gate-2 done).
//
// src/adapters/claude-code.ts exports:
//   - AgentSpawnRequest interface
//   - AgentSpawnRaw interface
//   - AgentSpawner interface
//   - spawner field on ClaudeCodeAdapterOptions (required)
//   - spawnAgent() method on ClaudeCodeAdapter (real implementation, WS-P1-05)
//
// These imports are the CONTRACT. If the shape changes, tests fail fast.
// ---------------------------------------------------------------------------
import {
  ClaudeCodeAdapter,
  type AgentSpawnRequest,
  type AgentSpawnRaw,
  type AgentSpawner,
} from "./claude-code.js";

// ---------------------------------------------------------------------------
// AgentRunner stub — spawnAgent() does not use the AgentRunner, but the
// ClaudeCodeAdapter constructor requires one (for sagePlan). We inject a
// no-op stub to satisfy the constructor.
// ---------------------------------------------------------------------------
import type { AgentRunner, AgentRunnerOpts, ToolCall, ToolResult } from "./claude-code.js";

const NO_OP_RUNNER: AgentRunner = {
  async *run(_opts: AgentRunnerOpts): AsyncGenerator<ToolCall, void, ToolResult> {
    // Never called in spawnAgent tests — yields nothing.
  },
};

// ---------------------------------------------------------------------------
// Temp roster helpers
//
// Agent definitions in the temp roster must match the real .md frontmatter
// format consumed by loadAgentDefinition(). See src/agents/load.ts.
//
// Each agent gets a known disallowedTools_default so tests can assert the union.
// ---------------------------------------------------------------------------

interface TempAgentSpec {
  id: string;
  disallowedTools?: string[];
}

function makeTempRoster(agents: TempAgentSpec[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-spawn-agent-test-"));
  for (const agent of agents) {
    const tools = agent.disallowedTools ?? [];
    const toolLines =
      tools.length === 0
        ? "disallowedTools_default:\n"
        : `disallowedTools_default:\n${tools.map((t) => `  - ${t}`).join("\n")}\n`;

    const content =
      `---\n` +
      `agent_id: ${agent.id}\n` +
      `name: ${agent.id} test agent\n` +
      `role: Test role for ${agent.id}\n` +
      toolLines +
      `---\n` +
      `\n` +
      `# ${agent.id}\n` +
      `Test agent body for ${agent.id}.\n`;

    fs.writeFileSync(path.join(dir, `${agent.id}.md`), content, "utf8");
  }
  return dir;
}

function cleanupTempRoster(dir: string): void {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    fs.unlinkSync(path.join(dir, f));
  }
  fs.rmdirSync(dir);
}

// ---------------------------------------------------------------------------
// Mock AgentSpawner factory
//
// makeMockSpawner returns an AgentSpawner that:
//   - Resolves with a fixed AgentSpawnRaw on each call
//   - Records every AgentSpawnRequest it received for assertion
//
// Usage:
//   const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
// ---------------------------------------------------------------------------

interface MockSpawnerResult {
  spawner: AgentSpawner;
  capturedRequests: AgentSpawnRequest[];
}

function makeMockSpawner(response: AgentSpawnRaw): MockSpawnerResult {
  const capturedRequests: AgentSpawnRequest[] = [];
  const spawner: AgentSpawner = {
    async spawn(req: AgentSpawnRequest): Promise<AgentSpawnRaw> {
      capturedRequests.push(req);
      return response;
    },
  };
  return { spawner, capturedRequests };
}

function makeRejectingSpawner(errorMessage: string): AgentSpawner {
  return {
    async spawn(_req: AgentSpawnRequest): Promise<AgentSpawnRaw> {
      throw new Error(errorMessage);
    },
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const VALID_AGENT_CONTEXT: AgentContext = {
  planId: "plan-spawn-001",
  projectId: "spawn-test-project",
  stepTimeoutMs: 30_000,
};

function makeAgentTask(
  overrides: Partial<{
    id: string;
    agent_id: string;
    prompt: string;
    disallowedTools: string[];
  }>
): TEOTask {
  return {
    id: overrides.id ?? "task-spawn-1",
    type: "AGENT",
    agent_id: overrides.agent_id ?? "test-agent",
    prompt: overrides.prompt ?? "Do the work.",
    needs: [],
    gates: [],
    ...(overrides.disallowedTools !== undefined
      ? { disallowedTools: overrides.disallowedTools }
      : {}),
  } as TEOTask;
}

// =============================================================================
// MISUSE TESTS — things callers should NOT do; spawnAgent must handle gracefully
// =============================================================================

describe("ClaudeCodeAdapter.spawnAgent — misuse: wrong task type", () => {
  // -------------------------------------------------------------------------
  // A SCRIPT task must never reach spawnAgent in normal flow, but defensive
  // code must handle it gracefully. Callers might be wrong. spawnAgent must
  // return BLOCKED (status "FAILED", detail starting "BLOCKED:"), not throw.
  // -------------------------------------------------------------------------
  it("returns BLOCKED when called with a SCRIPT task (wrong type)", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const scriptTask: TEOTask = {
        id: "wrong-type-task",
        type: "SCRIPT",
        command: "npm test",
        needs: [],
        gates: [],
      };

      const result = await adapter.spawnAgent(scriptTask, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("wrong-type-task");
      expect(result.status).toBe("FAILED");
      expect(result.detail).toMatch(/^BLOCKED:/);
      // The detail must name the wrong type so callers can diagnose
      expect(result.detail).toMatch(/SCRIPT|non-AGENT|task type/i);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // Unknown agent_id: no .md file in the roster for the agent_id on the task.
  // spawnAgent must NOT crash/throw — it wraps the loader error and returns BLOCKED.
  // -------------------------------------------------------------------------
  it("returns BLOCKED (not a crash) when agent_id is not in the roster", async () => {
    const rosterDir = makeTempRoster([{ id: "known-agent" }]);
    try {
      const { spawner } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "missing-agent-task", agent_id: "does-not-exist" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("missing-agent-task");
      expect(result.status).toBe("FAILED");
      expect(result.detail).toMatch(/^BLOCKED:/);
      // Must name the agent id so callers can diagnose
      expect(result.detail).toMatch(/does-not-exist|unknown agent/i);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // Path-traversal agent_id: agent_id contains ".." which loadAgentDefinition
  // rejects with a path-traversal guard error. spawnAgent must return BLOCKED,
  // not propagate the error as an uncaught throw.
  // -------------------------------------------------------------------------
  it("returns BLOCKED (not a crash) when agent_id contains path traversal sequences", async () => {
    const rosterDir = makeTempRoster([]);
    try {
      const { spawner } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      // loadAgentDefinition throws on ".." — spawnAgent must catch and BLOCK
      const task = makeAgentTask({ id: "traversal-task", agent_id: "../etc/passwd" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("traversal-task");
      expect(result.status).toBe("FAILED");
      expect(result.detail).toMatch(/^BLOCKED:/);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // Mock spawner is never called for misuse cases (SCRIPT task, unknown agent).
  // This asserts no wasteful or erroneous spawner invocations happen before
  // the guard checks succeed.
  // -------------------------------------------------------------------------
  it("does NOT call spawner when task type is SCRIPT (guard fires first)", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const scriptTask: TEOTask = {
        id: "no-spawn-task",
        type: "SCRIPT",
        command: "true",
        needs: [],
        gates: [],
      };

      await adapter.spawnAgent(scriptTask, VALID_AGENT_CONTEXT);

      expect(capturedRequests).toHaveLength(0);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  it("does NOT call spawner when agent_id is unknown (guard fires first)", async () => {
    const rosterDir = makeTempRoster([]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "no-spawn-task-2", agent_id: "ghost-agent" });
      await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(capturedRequests).toHaveLength(0);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });
});

// =============================================================================
// BOUNDARY TESTS — fail-safe verdict parsing and spawner error handling
// =============================================================================

describe("ClaudeCodeAdapter.spawnAgent — boundary: verdict fail-safe", () => {
  // -------------------------------------------------------------------------
  // NO verdict block in output → BLOCKED.
  // This is the most important fail-safe: missing verdict is NEVER PASS.
  // The status must be "FAILED" (not "PASS", not "SKIPPED").
  // The detail must start with "BLOCKED:".
  // -------------------------------------------------------------------------
  it("returns BLOCKED when spawner output contains no VERDICT block", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output: "I ran the tests and everything looks good. All checks passed.",
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "no-verdict-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("no-verdict-task");
      expect(result.status).toBe("FAILED");
      expect(result.status).not.toBe("PASS");
      expect(result.detail).toMatch(/^BLOCKED:/);
      expect(result.detail).toMatch(/no verdict|verdict/i);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // Garbage/ambiguous output (no parseable verdict line) → BLOCKED.
  // Tests that the regex requires the full VERDICT: PASS|FAIL format.
  // -------------------------------------------------------------------------
  it("returns BLOCKED for garbage output with no parseable verdict", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output: "VERDICT:PASS\nverdict pass\nVERDICT: pass\nPASS\nFAIL",
        // Note: lowercase "pass" and "verdict" variants — must NOT match
        // The regex requires exact case-sensitive "VERDICT: PASS" or "VERDICT: FAIL"
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "garbage-verdict-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("garbage-verdict-task");
      expect(result.status).toBe("FAILED");
      expect(result.detail).toMatch(/^BLOCKED:/);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // CONFLICTING verdicts: output contains BOTH "VERDICT: PASS" and "VERDICT: FAIL".
  // Rule: treat as ambiguous → BLOCKED with detail "BLOCKED: conflicting verdicts".
  // This is NEVER treated as PASS.
  // -------------------------------------------------------------------------
  it("returns BLOCKED when output contains both VERDICT: PASS and VERDICT: FAIL", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output:
          "Starting work...\n" +
          "VERDICT: PASS\n" +
          "Wait, actually some tests failed.\n" +
          "VERDICT: FAIL\n",
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "conflicting-verdict-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("conflicting-verdict-task");
      expect(result.status).toBe("FAILED");
      expect(result.status).not.toBe("PASS");
      expect(result.detail).toMatch(/^BLOCKED:/);
      expect(result.detail).toMatch(/conflict/i);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // Spawner THROWS / rejects → BLOCKED (fail-safe).
  // spawnAgent must NOT propagate the throw — it catches and returns BLOCKED.
  // The detail must include the original error message for diagnostics.
  // -------------------------------------------------------------------------
  it("returns BLOCKED (not an uncaught throw) when spawner rejects", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const rejectingSpawner = makeRejectingSpawner("Claude Code subprocess crashed");
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner: rejectingSpawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "spawner-crash-task" });

      // Must resolve, NOT reject
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("spawner-crash-task");
      expect(result.status).toBe("FAILED");
      expect(result.detail).toMatch(/^BLOCKED:/);
      // The original error message must appear in detail for diagnostics
      expect(result.detail).toMatch(/Claude Code subprocess crashed/);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // spawnAgent does NOT throw even when spawner rejects — it always resolves.
  // This test explicitly checks the promise resolves (does not reject).
  // -------------------------------------------------------------------------
  it("promise resolves (never rejects) even when spawner throws", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const rejectingSpawner = makeRejectingSpawner("network timeout");
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner: rejectingSpawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "no-reject-task" });

      // If this throws, the test fails — proving the promise resolves
      await expect(adapter.spawnAgent(task, VALID_AGENT_CONTEXT)).resolves.toBeDefined();
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // Empty output (spawner returns output: "") → BLOCKED.
  // An empty string contains no verdict block.
  // -------------------------------------------------------------------------
  it("returns BLOCKED when spawner output is empty string", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({ output: "" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "empty-output-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("empty-output-task");
      expect(result.status).toBe("FAILED");
      expect(result.detail).toMatch(/^BLOCKED:/);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // Verdict buried in noise: "VERDICT: PASS" must be on its own line.
  // A partial match like "VERDICT: PASSED" or "My VERDICT: PASS here" must NOT
  // be accepted as a verdict (the regex anchors to line start and end).
  //
  // This tests the case-sensitive, line-anchored nature of the regex:
  //   /^VERDICT:\s*(PASS|FAIL)\s*$/m
  // -------------------------------------------------------------------------
  it("returns BLOCKED when VERDICT: PASS appears embedded mid-line (not line-anchored)", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        // These should NOT match the verdict regex — they're not line-anchored
        output:
          "The final VERDICT: PASS for this test\n" +
          "Result: VERDICT: PASS is what I see\n" +
          "VERDICT: PASSED (with extra text)\n",
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "embedded-verdict-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("embedded-verdict-task");
      expect(result.status).toBe("FAILED");
      expect(result.detail).toMatch(/^BLOCKED:/);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // Verdict is case-sensitive: "verdict: pass" (lowercase) must NOT match.
  // Only "VERDICT: PASS" or "VERDICT: FAIL" (uppercase) are valid.
  // -------------------------------------------------------------------------
  it("returns BLOCKED when output contains lowercase 'verdict: pass' (case-sensitive regex)", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output: "verdict: pass\nVerdict: PASS\nVERDICT: pass\n",
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "lowercase-verdict-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("lowercase-verdict-task");
      expect(result.status).toBe("FAILED");
      expect(result.detail).toMatch(/^BLOCKED:/);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });
});

describe("ClaudeCodeAdapter.spawnAgent — boundary: taskId echoing", () => {
  // -------------------------------------------------------------------------
  // taskId in the returned StepResult must always echo task.id exactly,
  // regardless of whether the result is PASS, FAILED, or BLOCKED.
  // This holds for every code path.
  // -------------------------------------------------------------------------
  it("echoes task.id as taskId in PASS result", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "my-specific-task-id" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("my-specific-task-id");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  it("echoes task.id as taskId in FAILED (VERDICT: FAIL) result", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({ output: "VERDICT: FAIL" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "fail-task-echo" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("fail-task-echo");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  it("echoes task.id as taskId in BLOCKED result", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({ output: "no verdict here" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "blocked-task-echo" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("blocked-task-echo");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });
});

describe("ClaudeCodeAdapter.spawnAgent — boundary: AgentSpawnRequest fields", () => {
  // -------------------------------------------------------------------------
  // The AgentSpawnRequest the spawner RECEIVES must carry:
  //   - agentDefinition: the loaded AgentDefinition for the agent_id
  //   - prompt: task.prompt verbatim
  //   - timeoutMs: context.stepTimeoutMs verbatim
  //   - disallowedTools: union (see dedicated union tests below)
  // -------------------------------------------------------------------------
  it("passes task.prompt verbatim in the AgentSpawnRequest", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({
        id: "prompt-check-task",
        prompt: "Run all integration tests and report coverage.",
      });
      await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]!.prompt).toBe("Run all integration tests and report coverage.");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  it("passes context.stepTimeoutMs as timeoutMs in the AgentSpawnRequest", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "timeout-check-task" });
      const context: AgentContext = {
        planId: "plan-t",
        projectId: "proj-t",
        stepTimeoutMs: 90_000,
      };
      await adapter.spawnAgent(task, context);

      expect(capturedRequests[0]!.timeoutMs).toBe(90_000);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  it("passes the loaded AgentDefinition (with correct agent_id) in the AgentSpawnRequest", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent", disallowedTools: ["Write"] }]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "def-check-task", agent_id: "test-agent" });
      await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(capturedRequests).toHaveLength(1);
      const def = capturedRequests[0]!.agentDefinition;
      expect(def.agent_id).toBe("test-agent");
      // The loaded definition must match what is in the .md file
      expect(def.disallowedTools_default).toContain("Write");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });
});

describe("ClaudeCodeAdapter.spawnAgent — boundary: disallowedTools union", () => {
  // -------------------------------------------------------------------------
  // The disallowedTools in the AgentSpawnRequest is the SET UNION of:
  //   agent.disallowedTools_default  (from the loaded agent definition)
  //   task.disallowedTools           (from the task, may be undefined)
  //
  // All members from both sources must appear in the request.
  // Order and deduplication are not specified.
  // -------------------------------------------------------------------------

  it("request.disallowedTools is the union of agent defaults and task disallowedTools", async () => {
    // Agent has defaults: ["Write", "Edit"]
    // Task adds: ["Bash"]
    // Expected union: all three present
    const rosterDir = makeTempRoster([
      { id: "restricted-agent", disallowedTools: ["Write", "Edit"] },
    ]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({
        id: "union-task",
        agent_id: "restricted-agent",
        disallowedTools: ["Bash"],
      });
      await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      const requestedTools = capturedRequests[0]!.disallowedTools;
      // All three must be present (union)
      expect(requestedTools).toContain("Write");
      expect(requestedTools).toContain("Edit");
      expect(requestedTools).toContain("Bash");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  it("request.disallowedTools contains agent defaults when task has no disallowedTools", async () => {
    const rosterDir = makeTempRoster([
      { id: "agent-with-defaults", disallowedTools: ["Write", "Edit"] },
    ]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      // Task has no disallowedTools field
      const task: TEOTask = {
        id: "agent-defaults-only-task",
        type: "AGENT",
        agent_id: "agent-with-defaults",
        prompt: "Do some work.",
        needs: [],
        gates: [],
      };
      await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      const requestedTools = capturedRequests[0]!.disallowedTools;
      expect(requestedTools).toContain("Write");
      expect(requestedTools).toContain("Edit");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  it("request.disallowedTools contains task tools when agent has no defaults", async () => {
    const rosterDir = makeTempRoster([{ id: "no-defaults-agent", disallowedTools: [] }]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({
        id: "task-tools-only-task",
        agent_id: "no-defaults-agent",
        disallowedTools: ["Bash", "Write"],
      });
      await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      const requestedTools = capturedRequests[0]!.disallowedTools;
      expect(requestedTools).toContain("Bash");
      expect(requestedTools).toContain("Write");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  it("request.disallowedTools is a superset when agent and task both have entries", async () => {
    // Verify no entries are dropped from either side
    const rosterDir = makeTempRoster([
      { id: "sage-like-agent", disallowedTools: ["Write", "Edit", "Bash"] },
    ]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({
        id: "superset-task",
        agent_id: "sage-like-agent",
        disallowedTools: ["Read", "Glob"],
      });
      await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      const requestedTools = capturedRequests[0]!.disallowedTools;
      // Agent defaults
      expect(requestedTools).toContain("Write");
      expect(requestedTools).toContain("Edit");
      expect(requestedTools).toContain("Bash");
      // Task additions
      expect(requestedTools).toContain("Read");
      expect(requestedTools).toContain("Glob");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });
});

// =============================================================================
// GOLDEN PATH TESTS — happy-path behavior
// =============================================================================

describe("ClaudeCodeAdapter.spawnAgent — golden: VERDICT: PASS", () => {
  // -------------------------------------------------------------------------
  // Mock spawner returns output containing "VERDICT: PASS" on its own line.
  // spawnAgent must return status "PASS".
  // -------------------------------------------------------------------------
  it("returns status PASS when spawner output contains VERDICT: PASS on its own line", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output:
          "Running tests...\n" + "All 42 tests passed.\n" + "Coverage: 99.2%\n" + "VERDICT: PASS\n",
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "pass-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("pass-task");
      expect(result.status).toBe("PASS");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // VERDICT: PASS with trailing whitespace on the line must still be accepted.
  // The regex allows /^VERDICT:\s*(PASS|FAIL)\s*$/m — trailing spaces are fine.
  // -------------------------------------------------------------------------
  it("accepts VERDICT: PASS with trailing whitespace on the line", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output: "Output here\nVERDICT: PASS   \n",
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "trailing-ws-pass-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.status).toBe("PASS");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });
});

describe("ClaudeCodeAdapter.spawnAgent — golden: VERDICT: FAIL", () => {
  // -------------------------------------------------------------------------
  // Mock spawner returns output containing "VERDICT: FAIL" on its own line.
  // spawnAgent must return status "FAILED" (the runner's StepResult union value).
  // -------------------------------------------------------------------------
  it("returns status FAILED when spawner output contains VERDICT: FAIL on its own line", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output:
          "Running tests...\n" +
          "3 tests failed: auth.test.ts, runner.test.ts, gate.test.ts\n" +
          "Coverage: 87.1% (below 99% threshold)\n" +
          "VERDICT: FAIL\n",
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "fail-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("fail-task");
      expect(result.status).toBe("FAILED");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // VERDICT: FAIL with trailing whitespace — same acceptance rule as PASS.
  // -------------------------------------------------------------------------
  it("accepts VERDICT: FAIL with trailing whitespace on the line", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output: "Output here\nVERDICT: FAIL  \n",
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "trailing-ws-fail-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.status).toBe("FAILED");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // "VERDICT: FAIL" result's detail does NOT start with "BLOCKED:" — it is a
  // clean FAILED (the agent reported failure, not an infrastructure error).
  // Tests distinguish between agent-reported FAIL vs BLOCKED.
  // -------------------------------------------------------------------------
  it("VERDICT: FAIL result detail does NOT start with BLOCKED: (clean agent failure)", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({ output: "VERDICT: FAIL\n" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "clean-fail-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.status).toBe("FAILED");
      // If detail is set, it must NOT look like a BLOCKED infrastructure error
      if (result.detail !== undefined) {
        expect(result.detail).not.toMatch(/^BLOCKED:/);
      }
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });
});

describe("ClaudeCodeAdapter.spawnAgent — golden: single spawner call", () => {
  // -------------------------------------------------------------------------
  // For a valid AGENT task with a known agent_id, exactly one spawner.spawn()
  // call must occur. No retry logic, no double-spawn.
  // -------------------------------------------------------------------------
  it("calls spawner.spawn() exactly once per spawnAgent invocation", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "single-spawn-task" });
      await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(capturedRequests).toHaveLength(1);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // Multiple sequential spawnAgent() calls each invoke spawner once.
  // The adapter holds no cross-call state that would cause double-spawning.
  // -------------------------------------------------------------------------
  it("spawns once per call across multiple sequential invocations", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner, capturedRequests } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task1 = makeAgentTask({ id: "seq-task-1" });
      const task2 = makeAgentTask({ id: "seq-task-2" });
      const task3 = makeAgentTask({ id: "seq-task-3" });

      await adapter.spawnAgent(task1, VALID_AGENT_CONTEXT);
      await adapter.spawnAgent(task2, VALID_AGENT_CONTEXT);
      await adapter.spawnAgent(task3, VALID_AGENT_CONTEXT);

      expect(capturedRequests).toHaveLength(3);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });
});

describe("ClaudeCodeAdapter.spawnAgent — golden: model-free", () => {
  // -------------------------------------------------------------------------
  // spawnAgent() with injected mock spawner must complete without any network
  // calls. The no-network setup in vitest.config.ts blocks fetch() globally.
  // If this resolves, zero outbound HTTP occurred.
  // -------------------------------------------------------------------------
  it("completes without any network calls (model-free with injected mock spawner)", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({ output: "VERDICT: PASS" });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "network-free-spawn-task" });

      // If fetch() were called, the no-network guard in vitest.config.ts would throw.
      await expect(adapter.spawnAgent(task, VALID_AGENT_CONTEXT)).resolves.toBeDefined();
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });
});

// =============================================================================
// BOUNDARY TESTS — errored: true flag behavior (gate-1, pre-implementation)
//
// AgentSpawnRaw.errored is an optional flag the spawner sets on soft errors
// (subprocess exited non-zero but still produced output).
//
// Rules:
//   1. errored: true + no parseable verdict  → BLOCKED (infrastructure error)
//      detail must start with "BLOCKED:" AND mention "spawner errored" or "errored"
//   2. errored: true + VERDICT: PASS output  → status "PASS" (verdict wins)
//   3. errored: true + VERDICT: FAIL output  → status "FAILED", detail does NOT
//      start with "BLOCKED:" (clean agent failure, not infrastructure error)
//   4. errored: false + no verdict           → status "FAILED", detail matches
//      "BLOCKED: no verdict in output" (confirms the two paths are distinguishable)
// =============================================================================

describe("ClaudeCodeAdapter.spawnAgent — boundary: errored flag", () => {
  // -------------------------------------------------------------------------
  // errored: true, no parseable verdict → BLOCKED (infrastructure error path).
  // The detail must signal "spawner errored", distinguishable from a plain
  // "no verdict" that occurs without errored.
  // -------------------------------------------------------------------------
  it("returns BLOCKED with errored detail when errored: true and output has no parseable verdict", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output: "Subprocess exited with code 1. No verdict produced.",
        errored: true,
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "errored-no-verdict-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("errored-no-verdict-task");
      expect(result.status).toBe("FAILED");
      expect(result.detail).toMatch(/^BLOCKED:/);
      // Must distinguish this as the "spawner errored" path, not a plain no-verdict
      expect(result.detail).toMatch(/spawner errored|errored/i);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // errored: true, VERDICT: PASS in output → verdict wins.
  // Even if the spawner set errored, a parseable PASS verdict is authoritative.
  // -------------------------------------------------------------------------
  it("returns PASS when errored: true but output contains VERDICT: PASS (verdict wins)", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output: "Some stderr noise\nVERDICT: PASS\n",
        errored: true,
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "errored-with-pass-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("errored-with-pass-task");
      expect(result.status).toBe("PASS");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // errored: true, VERDICT: FAIL in output → clean FAILED (not BLOCKED).
  // The agent reported failure via verdict; this is a clean failure signal,
  // not an infrastructure error. detail must NOT start with "BLOCKED:".
  // -------------------------------------------------------------------------
  it("returns FAILED without BLOCKED: prefix when errored: true and output has VERDICT: FAIL", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output: "Tests failed.\nVERDICT: FAIL\n",
        errored: true,
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "errored-with-fail-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("errored-with-fail-task");
      expect(result.status).toBe("FAILED");
      // Clean agent failure — must NOT be presented as an infrastructure BLOCKED error
      if (result.detail !== undefined) {
        expect(result.detail).not.toMatch(/^BLOCKED:/);
      }
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // errored: false (explicit), no verdict → BLOCKED: no verdict in output.
  // This is the non-errored no-verdict path. The detail must match the plain
  // "no verdict" message, NOT the "spawner errored" message.
  // This confirms the two paths (errored vs not-errored) produce distinguishable output.
  // -------------------------------------------------------------------------
  it("returns BLOCKED with no-verdict detail (not errored path) when errored: false and no verdict", async () => {
    const rosterDir = makeTempRoster([{ id: "test-agent" }]);
    try {
      const { spawner } = makeMockSpawner({
        output: "I ran the tests and everything looks good.",
        errored: false,
      });
      const adapter = new ClaudeCodeAdapter({
        runner: NO_OP_RUNNER,
        spawner,
        agentsDir: rosterDir,
      });

      const task = makeAgentTask({ id: "not-errored-no-verdict-task" });
      const result = await adapter.spawnAgent(task, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("not-errored-no-verdict-task");
      expect(result.status).toBe("FAILED");
      // Must be the plain no-verdict BLOCKED path, not the errored path
      expect(result.detail).toMatch(/BLOCKED: no verdict in output/);
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });
});

// =============================================================================
// INTEGRATION TEST GUARD
//
// Real-model integration tests (Claude Code real subprocess spawn) MUST live in:
//   src/adapters/spawn-agent.integration.test.ts
//
// They MUST be gated behind an environment variable check:
//   if (!process.env.INTEGRATION_TESTS) test.skip(...)
//
// The unit suite above must remain 100% model-free — validated by the
// no-network setup file that blocks global fetch across all vitest runs.
//
// To run integration tests (when implemented):
//   INTEGRATION_TESTS=1 npx vitest run src/adapters/spawn-agent.integration.test.ts
// =============================================================================
