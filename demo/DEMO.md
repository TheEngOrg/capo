# TEO 5 — Demo Runbook

A ~5-minute walkthrough. Two tasks — a **simple** one and a **planned** one — then the
audit trail behind them. Everything below is real: real signed plans, real signatures, a
real append-only ledger. The scripted demos run with **zero LLM tokens**, so nothing
depends on a model round-trip landing on stage.

## The one-liner before you start

> An LLM agent is the most expensive, least deterministic, least auditable way to do
> anything. So in TEO it's the tool of last resort. The engine plans the work, runs the
> mechanical majority as plain scripts at zero cost, spends an agent only where the work
> needs real judgment, and signs + logs every step into a ledger you can audit and bill
> from.

## Setup (do this once, before the room is watching)

Everything runs against a self-contained demo home so it never touches your real `~/.teo`.
Export this in the terminal you'll present from:

```sh
cd <repo-root>/the-eng-org
export TEO_HOME=demo/.teo-home
```

Build the demo home (signing key + agent registry + the two signed plans). This is the
first run only — the home isn't committed, because it contains an HMAC signing key and a
key never belongs in a repo. That's TEO's own rule (architecture §2), so the demo follows it:

```sh
npx tsx demo/build-plans.ts
```

Reset to a clean slate so the audit starts at seq 1:

```sh
npx tsx demo/reset.ts
```

Optional smoke-check that the binary is alive (don't show this):

```sh
npx tsx src/index.ts --help
```

> If `npx tsx` feels slow on stage, build the standalone binary first
> (`npm run build:darwin`) and swap `npx tsx src/index.ts` → `dist/teo-darwin-arm64`.

---

## Act 1 — The simple task (a script, not an agent)

**Say:** "Deploying to staging is mechanical. A human could do it with one fixed command.
So TEO doesn't spend an agent on it — it's a SCRIPT task. Zero tokens."

Show the plan is a single script task:

```sh
jq '{description, tasks:[.tasks[]|{order:.task_order, type:.task_actor_type, script:.script.path}]}' \
  demo/plans/demo-simple-deploy-staging.json
```

Run it:

```sh
npx tsx src/index.ts run demo/plans/demo-simple-deploy-staging.json
```

**Point at:** `status: "pending-human"`, the one task `pass`. The run completed — goods
delivered, parked for a human to sign off whenever. No LLM was involved at all.

---

## Act 2 — The planned task (agents, a signed gate, then a script)

**Say:** "Now something that needs judgment. Ship a `/health` endpoint to staging. Sage
decomposed this into: build it, test it, a QA gate that has to pass before anything
deploys, then the deploy. The gate is **signed** — that's the part that matters."

Show the shape:

```sh
jq '[.tasks[]|{order:.task_order, type:(.task_actor_type // "GATE"), id:.task_id, gate_owner}]' \
  demo/plans/demo-planned-health-feature.json
```

Run it:

```sh
npx tsx src/index.ts run demo/plans/demo-planned-health-feature.json
```

**Point at:** the `qa-gate` task — `verdict: "pass"`, a `signed_by` agent id (e.g.
`qa-001`), and a real `signature`. Build → test → **gate (signed)** → deploy, in order,
deterministically. The gate isn't a vibe; it's an HMAC verdict tied to one agent id.

Then the human signs off — a separate, async step:

```sh
npx tsx src/index.ts gate demo/plans/demo-planned-health-feature.json accept \
  --as byazaki --reason "ship it"
```

**Point at:** `status: "closed"`. The human gate is never a blocking prompt — the goods
were already delivered; the human accepts on their own clock.

---

## Act 3 — See the audit after

**Say:** "Every step we just ran appended one immutable line to a per-plan ledger. This is
what an auditor or finance reads. Nothing here is ever mutated or deleted."

The ledger, one line per event:

```sh
npx tsx src/index.ts audit demo/plans/demo-planned-health-feature.json \
  | jq -c '.events[] | {seq, phase, actor_id, verdict, signed:(.signature!=null)}'
```

**Point at, in order:**
- `seq` is monotonic, 1..13. A gap or out-of-order seq is a tamper signal — the auditor
  just reads the file.
- the **GATE** line (around seq 8) — `actor_id: qa-00x`, `signed: true`.
- the **HUMAN_GATE** line (seq 13) — `actor_id: human:byazaki`, `signed: true`. The only
  two signed lines in the whole ledger are the two that carry authority.
- Every verdict names exactly one actor. A false positive traces to one signer, not an
  ambient token sitting in a memory dir.

Then the finance rollup — cost by actor, falls straight out of the ledger:

```sh
npx tsx src/index.ts audit demo/plans/demo-planned-health-feature.json | jq '.finance'
```

**Point at:** `total.cost_usd: 0` **and `llm_calls.total: 0`**. This whole planned
workstream — build, test, signed gate, deploy, human sign-off — made **zero LLM calls**,
because the work was mechanical and TEO never reached for an agent. Hold that number; Act 4
runs a plan that *does* spend agents, and you'll watch the count go from 0 to 3. When a task
spends an agent, its call, tokens, and `cost_usd` land on that actor's line, and per-client
cost rolls up by project namespace.

---

## Act 4 — Live, end-to-end, with real LLM calls

Acts 1–3 cost $0 because they're all-SCRIPT. This act runs a plan that actually *spends
agents* — an engineer, devops, and QA each make a real `claude` call — so you can show the
full arc and the LLM-call count coming out of the audit.

**Say:** "Now a plan that needs judgment. Engineer drafts the endpoint, devops notes the
rollout, QA reviews — three real agent calls — then a signed gate and a mechanical deploy.
Watch what the audit says it cost."

Show the task mix (3 agent tasks → gate → script):

```sh
jq '[.tasks[]|{order:.task_order, type:(.task_actor_type // "GATE"), id:.task_id}]' \
  demo/plans/demo-live-agent-feature.json
```

Run it live (~20s — three real `claude` calls):

```sh
npx tsx src/index.ts run demo/plans/demo-live-agent-feature.json
```

**Point at:** each agent task passes with `detail.model: claude-opus-4-8` — those are the
live calls. The `qa-gate` is signed; the deploy is a script. Same pipeline as Act 2, but now
agents did real work.

Sign off, then audit the cost + call count:

```sh
npx tsx src/index.ts gate demo/plans/demo-live-agent-feature.json accept --as byazaki --reason "reviewed"
npx tsx src/index.ts audit demo/plans/demo-live-agent-feature.json | jq '.finance.llm_calls'
npx tsx src/index.ts audit demo/plans/demo-live-agent-feature.json | jq '.finance.total'
```

**Point at:**
- `llm_calls.total: 3` — and `byActor` attributes each call to one agent id (`eng-…`,
  `coord-…`, `qa-…`). Every LLM call is named and counted.
- `total.cost_usd` — a real dollar figure, ~$0.50, with real token counts.
- The contrast lands here: Act 1's whole workstream was **0 calls / $0** because it was
  mechanical. This one spent 3 calls only where judgment was actually needed. That's the
  thesis — agents are the line item you can see and minimize, not an invisible default.

> This act makes real model calls — slower, and it can hiccup. The pre-baked plan keeps it
> as reliable as a live LLM gets, but if it stumbles, Acts 1–3 already told the story. Run
> `demo/reset.ts` and you can retry cleanly.

### Optional — the live Sage planner

To also show Sage *writing* a plan in real time (one more live call):

```sh
npx tsx src/index.ts plan "Add a /version endpoint that returns the app semver, then deploy to staging" \
  --out /tmp/live-plan.json
jq '[.tasks[]|{order:.task_order, type:(.task_actor_type), id:.task_id}]' /tmp/live-plan.json
```

**Point at:** Sage independently splits this into agent tasks, a signed gate, and a SCRIPT
deploy — the script-vs-agent line, decided live. You can then `teo run /tmp/live-plan.json`
to execute the plan Sage just wrote (it'll make a live call per agent task).

---

## Reset between runs

```sh
npx tsx demo/reset.ts
```

Clears the telemetry; keeps the signed plans, the agent registry, and the signing key. Run
it before each rehearsal and right before you present.

## If something goes sideways

- **"plan signature failed to verify"** — the demo home's signing key changed. Rebuild the
  plans: `npx tsx demo/build-plans.ts` (regenerates both signed plans against the current key).
- **Duplicate / high seq numbers in the audit** — you forgot to reset. Run `demo/reset.ts`.
- **A script task fails** — check `demo/scripts/*.sh` are still `+x`
  (`chmod +x demo/scripts/*.sh`).

## What's in this demo

```
demo/
  DEMO.md                 this runbook
  build-plans.ts          regenerates the two signed plans (real core, real signatures)
  reset.ts                clears telemetry, keeps plans + registry + key
  scripts/                the human-runnable library scripts the plans call
    build-health-endpoint.sh  test-health-endpoint.sh
    deploy-staging.sh         smoke-staging.sh
  plans/                  the two pre-baked signed plans
    demo-simple-deploy-staging.json
    demo-planned-health-feature.json
  .teo-home/              self-contained TEO home (keyring + registry + plans)
```
