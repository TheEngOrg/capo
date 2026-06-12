/**
 * build-plans.ts — generates the two pre-baked, signed demo plans.
 *
 * Run once to (re)produce demo/plans/*.json against demo/.teo-home. Uses the real
 * core modules, so the plans are genuinely signed + reference registered agents —
 * `teo run` accepts them exactly as it would a plan from `teo plan`.
 *
 *   TEO_HOME=demo/.teo-home npx tsx demo/build-plans.ts
 *
 * Note: SCRIPT-only plans (plus a signed gate) keep `teo run` deterministic and
 * zero-token on stage. The "watch Sage classify" moment is shown separately and
 * live via `teo plan`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureTeoHome, projectId, projectPaths, resolveTeoHome } from "../src/core/home/home.js";
import { issueAgent } from "../src/core/identity/identity.js";
import { type ExecutionPlan, savePlan, signPlan, validatePlan } from "../src/core/plan/plan.js";

const home = resolveTeoHome();
ensureTeoHome(home);

// Stable, path-independent project id so the demo rolls up under one namespace.
const project_id = projectId({ absPath: "teo-demo" });
const paths = projectPaths(home, project_id);
paths.ensure();

const created_at = "2026-06-12T00:00:00.000Z"; // fixed clock — reproducible plans
const sage = issueAgent(home, { agent_type: "SAGE", issued_at: created_at });
const qa = issueAgent(home, { agent_type: "QA", issued_at: created_at });
const eng = issueAgent(home, { agent_type: "ENGINEER", issued_at: created_at });
const devops = issueAgent(home, { agent_type: "COORD", issued_at: created_at });

const scriptDir = "demo/scripts";

// ── SIMPLE: one pure SCRIPT task. Mechanical work, zero LLM tokens. ──
const simple: ExecutionPlan = {
  plan_id: "demo-simple-deploy-staging",
  project_id,
  description: "Deploy the current build to staging (pure mechanical task — no agent).",
  created_by: sage.agent_id,
  created_at,
  schema_version: "5.0",
  tasks: [
    {
      task_id: "deploy-staging",
      task_order: 1,
      task_actor_type: "SCRIPT",
      description: "Deploy the build to the staging environment.",
      expected_output: "staging serving the new revision; smoke check green",
      script: { path: `${scriptDir}/deploy-staging.sh`, args: [], expect_exit: 0 },
      verifications: [{ kind: "script", cmd: `${scriptDir}/smoke-staging.sh`, expect_exit: 0 }],
    },
  ],
};

// ── PLANNED: build -> test -> SIGNED QA GATE -> deploy. ──
const planned: ExecutionPlan = {
  plan_id: "demo-planned-health-feature",
  project_id,
  description: "Ship a /health endpoint to staging: build, test, gate, deploy.",
  created_by: sage.agent_id,
  created_at,
  schema_version: "5.0",
  tasks: [
    {
      task_id: "build-health",
      task_order: 1,
      task_actor_type: "SCRIPT",
      description: "Build the /health endpoint into the router.",
      expected_output: "build artifact containing the /health route",
      script: { path: `${scriptDir}/build-health-endpoint.sh`, args: [], expect_exit: 0 },
      verifications: [],
    },
    {
      task_id: "test-health",
      task_order: 2,
      task_actor_type: "SCRIPT",
      description: "Run the test suite asserting GET /health returns 200.",
      expected_output: "test suite green",
      script: { path: `${scriptDir}/test-health-endpoint.sh`, args: [], expect_exit: 0 },
      verifications: [{ kind: "script", cmd: `${scriptDir}/test-health-endpoint.sh`, expect_exit: 0 }],
    },
    {
      task_id: "qa-gate",
      task_order: 3,
      is_gate: true,
      gate_owner: qa.agent_id,
      description: "Quality gate: tests pass before any deploy proceeds.",
      gate_constraints: [{ kind: "verification-ref", task_id: "test-health" }],
    },
    {
      task_id: "deploy-staging",
      task_order: 4,
      task_actor_type: "SCRIPT",
      description: "Deploy the gated build to staging.",
      expected_output: "staging serving /health; smoke check green",
      script: { path: `${scriptDir}/deploy-staging.sh`, args: [], expect_exit: 0 },
      verifications: [{ kind: "script", cmd: `${scriptDir}/smoke-staging.sh`, expect_exit: 0 }],
    },
  ],
};

// ── LIVE-AGENT: real LLM calls. ENGINEER writes, COORD/devops notes, QA reviews,
// then a signed gate and a SCRIPT deploy. The descriptions are small, self-
// contained prompts so the live `claude -p` calls return fast on stage. Each
// AGENT task is one live LLM call; Sage's plan is another. So `teo audit` shows
// llm_calls.total = (agent tasks) here, vs 0 for the all-SCRIPT plans. ──
const liveAgent: ExecutionPlan = {
  plan_id: "demo-live-agent-feature",
  project_id,
  description: "Add a /version endpoint: engineer drafts it, devops notes the rollout, QA reviews, gate, deploy.",
  created_by: sage.agent_id,
  created_at,
  schema_version: "5.0",
  tasks: [
    {
      task_id: "eng-draft",
      task_order: 1,
      task_actor: eng.agent_id,
      task_actor_type: "ENGINEER",
      description:
        "In one short paragraph, describe how you'd add a GET /version endpoint that returns the app's semver as JSON. No code, just the approach.",
      expected_output: "a short approach for a /version endpoint",
      verifications: [],
    },
    {
      task_id: "devops-rollout",
      task_order: 2,
      task_actor: devops.agent_id,
      task_actor_type: "COORD",
      description:
        "In two sentences, note the safest way to roll a tiny read-only endpoint like /version to staging then prod.",
      expected_output: "a brief rollout note",
      verifications: [],
    },
    {
      task_id: "qa-review",
      task_order: 3,
      task_actor: qa.agent_id,
      task_actor_type: "QA",
      description:
        "In two sentences, list what a test for GET /version must assert (status code and body shape).",
      expected_output: "a brief test checklist",
      verifications: [],
    },
    {
      task_id: "qa-gate",
      task_order: 4,
      is_gate: true,
      gate_owner: qa.agent_id,
      description: "Quality gate: engineering + QA review complete before deploy.",
      gate_constraints: [{ kind: "verification-ref", task_id: "qa-review" }],
    },
    {
      task_id: "deploy-staging",
      task_order: 5,
      task_actor_type: "SCRIPT",
      description: "Deploy the reviewed build to staging (mechanical — 0 tokens).",
      expected_output: "staging serving /version; smoke check green",
      script: { path: `${scriptDir}/deploy-staging.sh`, args: [], expect_exit: 0 },
      verifications: [{ kind: "script", cmd: `${scriptDir}/smoke-staging.sh`, expect_exit: 0 }],
    },
  ],
};

mkdirSync(resolve("demo/plans"), { recursive: true });

for (const plan of [simple, planned, liveAgent]) {
  const v = validatePlan(home, plan);
  if (!v.ok) throw new Error(`invalid ${plan.plan_id}: ${v.errors.join("; ")}`);
  const signed = signPlan(home, plan);
  savePlan(home, signed); // into ~/.teo home (so `teo run` finds project paths)
  const out = resolve(`demo/plans/${plan.plan_id}.json`);
  writeFileSync(out, `${JSON.stringify(signed, null, 2)}\n`);
  process.stdout.write(`wrote ${out} (${signed.tasks.length} tasks)\n`);
}
