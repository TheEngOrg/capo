// =============================================================================
// teo-run-entry.ts — CLI entrypoint for TEO runtime commands (WS-GO-02)
//
// CONTRACT (CLI arg protocol):
//   node bin/teo-run.js <command> '<json-string>'
//
// COMMANDS:
//   provision         — calls provision() with JSON opts
//   validate-plan     — validates JSON against Zod PlanSchema
//   validate-artifact — validates artifact payload against registered type schema
//   sign              — calls HmacSigner.sign() with payload
//   ledger-append     — calls AppendOnlyLedger.append()
//   ledger-close      — calls AppendOnlyLedger.close()
//   plan-init         — initializes a plan artifact (session_id, project_id, directive?)
//   evaluate-gate     — evaluates a gate (stub: always PASS, UNENFORCED_MOCK status)
//   verify-ledger     — reads a ledger JSONL file and verifies hash-chain integrity
//
// OUTPUT CONTRACT:
//   All stdout is a single JSON object. Errors are JSON { error: string }.
//   Exit code 0 = success, 1+ = error.
// =============================================================================

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { provision } from "../bootstrap/provision.js";
import { repairJson, validateArtifact } from "../core/artifacts.js";
import { PlanSchema } from "../core/plan.js";
import { HmacSigner } from "../core/sign.js";
import { AppendOnlyLedger, resolveDefaultLedgerBase } from "../core/ledger.js";
import { verifyAsync } from "../lib/ed25519.js";
import { buildRunReceipt, writeRunReceipt, verifyRunReceipt } from "../core/run-receipt.js";

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function writeJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function exitError(obj: unknown): never {
  writeJson(obj);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleProvision(args: unknown, jsonArg: string): Promise<void> {
  const opts = args as Parameters<typeof provision>[0];
  const baseDir = (args as Record<string, unknown>)["baseDir"] as string | undefined;
  const effectiveBaseDir = baseDir ?? resolveDefaultLedgerBase();

  // Convert Uint8Array-like serialized objects back to Uint8Array for revocation.
  // An all-zeros signature array is treated as "no signature provided" (undefined),
  // which allows the plugin-context fail-open path in checkRevocation() to fire.
  const rev = opts.revocationOpts as Record<string, unknown>;
  if (Array.isArray(rev["signature"])) {
    const arr = rev["signature"] as number[];
    const isAllZeros = arr.length > 0 && arr.every((b) => b === 0);
    rev["signature"] = isAllZeros ? undefined : new Uint8Array(arr);
  }
  if (Array.isArray(rev["publicKey"])) {
    rev["publicKey"] = new Uint8Array(rev["publicKey"] as number[]);
  }

  let result: Awaited<ReturnType<typeof provision>>;
  try {
    result = await provision(opts);
  } catch (err) {
    // provision() should not throw for anticipated errors, but if it does (e.g. ENOENT
    // from listAgentIds on a nonexistent bundleDir), wrap it as a structured error result.
    const message = err instanceof Error ? err.message : String(err);
    result = { status: "error", kind: "io_error", reason: message };
  }

  // Provision errors still exit 1 (to signal error to shell), but emit a FAIL receipt first.
  if (result.status === "error") {
    const failReceipt = buildRunReceipt({
      command: "provision",
      argsRaw: jsonArg,
      actor_id: "teo-run",
      outcome: "FAIL",
      exit_code: 1,
      baseDir: effectiveBaseDir,
    });
    writeRunReceipt(failReceipt, effectiveBaseDir);
    writeJson({ ...result, run_id: failReceipt.run_id, sig: failReceipt.sig });
    process.exit(1);
  }

  const receipt = buildRunReceipt({
    command: "provision",
    argsRaw: jsonArg,
    actor_id: "teo-run",
    outcome: "OK",
    exit_code: 0,
    baseDir: effectiveBaseDir,
  });
  writeRunReceipt(receipt, effectiveBaseDir);

  writeJson({ ...result, run_id: receipt.run_id, sig: receipt.sig });

  // S8: surface revocation warning to stderr so operators see it (not buried in JSON)
  if ("warning" in result && typeof result.warning === "string") {
    process.stderr.write(`[teo] provision warning: ${result.warning}\n`);
  }
}

function handleValidatePlan(args: unknown, jsonArg: string): void {
  const a = args as Record<string, unknown>;
  const baseDir = a["baseDir"] as string | undefined;
  const effectiveBaseDir = baseDir ?? resolveDefaultLedgerBase();

  const parsed = PlanSchema.safeParse(args);

  let result: Record<string, unknown>;
  if (parsed.success) {
    result = { valid: true };
  } else {
    result = {
      valid: false,
      errors: parsed.error.issues,
    };
  }

  const receipt = buildRunReceipt({
    command: "validate-plan",
    argsRaw: jsonArg,
    actor_id: "teo-run",
    outcome: "OK",
    exit_code: 0,
    baseDir: effectiveBaseDir,
  });
  writeRunReceipt(receipt, effectiveBaseDir);

  writeJson({ ...result, run_id: receipt.run_id, sig: receipt.sig });
}

function handleValidateArtifact(rawJsonArg: string): void {
  // Repair the raw arg string first (handles trailing commas, single-quoted strings, etc.)
  let parsedArg: unknown;
  try {
    const repaired = repairJson(rawJsonArg);
    parsedArg = JSON.parse(repaired) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeJson({ valid: false, errors: [`JSON repair/parse error: ${msg}`] });
    return;
  }

  const a = parsedArg as Record<string, unknown>;
  const type = a["type"] as string;
  const strictRaw = a["strict"];
  const baseDir = a["baseDir"] as string | undefined;
  const effectiveBaseDir = baseDir ?? resolveDefaultLedgerBase();
  let payload = a["payload"];

  // If payload is a string, attempt to repair + parse it as a JSON object/array.
  // jsonrepair may wrap a non-JSON string as a JSON string value — if after repair+parse
  // the result is still a primitive string, the content was not repairable as a JSON structure.
  if (typeof payload === "string") {
    let reparsed: unknown;
    try {
      const repairedPayload = repairJson(payload);
      reparsed = JSON.parse(repairedPayload) as unknown;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeJson({ valid: false, errors: [`JSON repair/parse error on payload: ${msg}`] });
      return;
    }
    // If repair just quoted the garbage as a JSON string, it is not a valid JSON object
    if (typeof reparsed === "string") {
      writeJson({
        valid: false,
        errors: [`JSON repair/parse failed: payload string could not be parsed as a JSON object`],
      });
      return;
    }
    payload = reparsed;
  }

  // Build call args — omit strict if not provided (exactOptionalPropertyTypes compatibility)
  const callArgs =
    typeof strictRaw === "boolean" ? { type, payload, strict: strictRaw } : { type, payload };

  const result = validateArtifact(callArgs);

  const receipt = buildRunReceipt({
    command: "validate-artifact",
    argsRaw: rawJsonArg,
    actor_id: "teo-run",
    outcome: "OK",
    exit_code: 0,
    baseDir: effectiveBaseDir,
  });
  writeRunReceipt(receipt, effectiveBaseDir);

  writeJson({ ...result, run_id: receipt.run_id, sig: receipt.sig });
}

function handleSign(args: unknown, jsonArg: string): void {
  const a = args as Record<string, unknown>;
  const baseDir = a["baseDir"] as string | undefined;
  const effectiveBaseDir = baseDir ?? resolveDefaultLedgerBase();
  const keyring_id = a["keyring_id"] as string | undefined;
  const signerOpts: ConstructorParameters<typeof HmacSigner>[0] = {};
  if (baseDir !== undefined) signerOpts.baseDir = baseDir;
  if (keyring_id !== undefined) signerOpts.keyring_id = keyring_id;
  const signer = new HmacSigner(signerOpts);

  const payload = a["payload"] as Parameters<typeof signer.sign>[0];
  const signature = signer.sign(payload);

  const receipt = buildRunReceipt({
    command: "sign",
    argsRaw: jsonArg,
    actor_id: "teo-run",
    outcome: "OK",
    exit_code: 0,
    baseDir: effectiveBaseDir,
  });
  writeRunReceipt(receipt, effectiveBaseDir);

  writeJson({ signature, run_id: receipt.run_id, sig: receipt.sig });
}

function handleLedgerAppend(args: unknown, jsonArg: string): void {
  const a = args as Record<string, unknown>;
  const baseDir = a["baseDir"] as string | undefined;
  const effectiveBaseDir = baseDir ?? resolveDefaultLedgerBase();
  const ledgerOpts: ConstructorParameters<typeof AppendOnlyLedger>[0] = {
    session_id: a["session_id"] as string,
  };
  if (baseDir !== undefined) ledgerOpts.baseDir = baseDir;
  const ledger = new AppendOnlyLedger(ledgerOpts);

  const entry = a["entry"] as Parameters<typeof ledger.append>[0];
  const result = ledger.append(entry);

  const receipt = buildRunReceipt({
    command: "ledger-append",
    argsRaw: jsonArg,
    actor_id: "teo-run",
    outcome: "OK",
    exit_code: 0,
    baseDir: effectiveBaseDir,
  });
  writeRunReceipt(receipt, effectiveBaseDir);

  writeJson({ ...result, run_id: receipt.run_id, sig: receipt.sig });
}

function handleLedgerClose(args: unknown, jsonArg: string): void {
  const a = args as Record<string, unknown>;
  const baseDir = a["baseDir"] as string | undefined;
  const effectiveBaseDir = baseDir ?? resolveDefaultLedgerBase();
  const ledgerOpts: ConstructorParameters<typeof AppendOnlyLedger>[0] = {
    session_id: a["session_id"] as string,
  };
  if (baseDir !== undefined) ledgerOpts.baseDir = baseDir;
  const ledger = new AppendOnlyLedger(ledgerOpts);

  const summary = a["summary"] as Parameters<typeof ledger.close>[0];
  ledger.close(summary);

  const receipt = buildRunReceipt({
    command: "ledger-close",
    argsRaw: jsonArg,
    actor_id: "teo-run",
    outcome: "OK",
    exit_code: 0,
    baseDir: effectiveBaseDir,
  });
  writeRunReceipt(receipt, effectiveBaseDir);

  writeJson({ ok: true, run_id: receipt.run_id, sig: receipt.sig });
}
const VALID_DIRECTIVES = new Set(["BUILD", "FIX", "REVIEW", "PLAN", "ARCHITECTURAL"]);

function handlePlanInit(args: unknown): void {
  const a = args as Record<string, unknown>;
  const session_id = a["session_id"] as string | undefined;
  const project_id = a["project_id"] as string | undefined;
  const directive = a["directive"] as string | undefined;

  if (typeof session_id !== "string" || !session_id || session_id.length === 0) {
    exitError({ error: "Missing required field: session_id" });
  }
  if (typeof project_id !== "string" || !project_id || project_id.length === 0) {
    exitError({ error: "Missing required field: project_id" });
  }
  if (directive !== undefined && !VALID_DIRECTIVES.has(directive)) {
    exitError({ error: `Invalid directive: ${directive}` });
  }

  const plan_id = `plan_${session_id}_${Date.now()}`;
  writeJson({ ok: true, session_id, plan_id, initialized_at: new Date().toISOString() });
}

function handleEvaluateGate(args: unknown): void {
  const a = args as Record<string, unknown>;

  // Validate required fields
  const gate_id = a["gate_id"];
  const task_id = a["task_id"];
  const session_id = a["session_id"];
  const gate_type = a["gate_type"];

  if (typeof gate_id !== "string" || gate_id.length === 0) {
    exitError({ error: "Missing required field: gate_id" });
  }
  if (typeof task_id !== "string" || task_id.length === 0) {
    exitError({ error: "Missing required field: task_id" });
  }
  if (typeof session_id !== "string" || session_id.length === 0) {
    exitError({ error: "Missing required field: session_id" });
  }
  if (typeof gate_type !== "string" || gate_type.length === 0) {
    exitError({ error: "Missing required field: gate_type" });
  }

  const baseDir = a["ledger_base_dir"] as string | undefined;
  const ledgerOpts: ConstructorParameters<typeof AppendOnlyLedger>[0] = {
    session_id,
  };
  if (baseDir !== undefined) ledgerOpts.baseDir = baseDir;
  const ledger = new AppendOnlyLedger(ledgerOpts);

  // Append a GATE ledger entry — stub, so verdict: null and UNENFORCED_MOCK status
  const entry = ledger.append({
    session_id,
    workflow_id: gate_id,
    task_id,
    turn_id: null,
    actor_id: "SYSTEM",
    actor_type: "SYSTEM",
    phase: "GATE",
    verdict: null,
    detail: {
      gate_id,
      gate_type,
      status: "UNENFORCED_MOCK",
    },
  });

  const evaluated_at = new Date().toISOString();

  writeJson({
    gate_id,
    task_id,
    session_id,
    verdict: "PASS", // stub verdict
    status: "UNENFORCED_MOCK", // L7 mandatory — never a real passing verdict
    evaluated_at,
    gate_type,
    ledger_seq: entry.seq,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function handleVerifyLedger(args: unknown, jsonArg: string): Promise<void> {
  const a = args as Record<string, unknown>;
  const ledger_file = a["ledger_file"];
  const public_key = a["public_key"];
  const baseDir = a["baseDir"] as string | undefined;
  const effectiveBaseDir = baseDir ?? resolveDefaultLedgerBase();

  // Validate required field
  if (typeof ledger_file !== "string" || ledger_file.length === 0) {
    exitError({ ok: false, error: "Missing required field: ledger_file" });
  }

  // Check file exists
  if (!fs.existsSync(ledger_file)) {
    exitError({ ok: false, error: `Ledger file not found: ${ledger_file}` });
  }

  // Read file content
  const fileContent = fs.readFileSync(ledger_file, "utf8");
  const rawLines = fileContent.split("\n").filter((l) => l.trim().length > 0);

  // Empty file check
  if (rawLines.length === 0) {
    exitError({ ok: false, error: "Ledger file is empty or contains no valid entries" });
  }

  // Parse all lines
  const parsedEntries: Array<{ raw: string; obj: Record<string, unknown> }> = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      exitError({ ok: false, error: `Malformed JSON at line ${i + 1}: ${raw.slice(0, 80)}` });
    }
    parsedEntries.push({ raw, obj: obj as Record<string, unknown> });
  }

  // Detect mode: if any entry has prev_hash, use Mode B (hash chain); otherwise Mode A (seq only)
  const hasAnyPrevHash = parsedEntries.some((e) => "prev_hash" in e.obj);

  if (hasAnyPrevHash) {
    // Mode B: hash chain verification
    for (let i = 0; i < parsedEntries.length; i++) {
      const entry = parsedEntries[i]!;
      const seq = entry.obj["seq"] as number | undefined;

      if (i === 0) {
        const prev_hash = entry.obj["prev_hash"];
        if (prev_hash !== null && prev_hash !== undefined) {
          exitError({
            ok: false,
            error: "Hash chain broken: first entry must have prev_hash null or absent",
            broken_at_seq: seq,
          });
        }
      } else {
        const prevRaw = parsedEntries[i - 1]!.raw;
        const expectedHash = crypto.createHash("sha256").update(prevRaw, "utf8").digest("hex");
        const prev_hash = entry.obj["prev_hash"];
        if (prev_hash !== expectedHash) {
          exitError({
            ok: false,
            error: `Hash chain broken at seq ${String(seq)}: prev_hash mismatch`,
            broken_at_seq: seq,
          });
        }
      }
    }
  } else {
    // Mode A: seq strictly monotonic 1..N (no gaps, duplicates, or out-of-order)
    for (let i = 0; i < parsedEntries.length; i++) {
      const entry = parsedEntries[i]!;
      const seq = entry.obj["seq"] as number | undefined;
      const expectedSeq = i + 1;

      if (seq !== expectedSeq) {
        exitError({
          ok: false,
          error: `Sequence broken: expected seq ${expectedSeq}, got ${String(seq)}`,
          broken_at_seq: seq,
        });
      }
    }
  }

  // Signature verification (when public_key provided)
  if (typeof public_key === "string" && public_key.length > 0) {
    const pubKeyBytes = Buffer.from(public_key, "hex");
    for (const entry of parsedEntries) {
      const sig = entry.obj["signature"];
      if (typeof sig === "string" && sig.length > 0) {
        const sigBytes = Buffer.from(sig, "hex");
        const lineBytes = Buffer.from(entry.raw, "utf8");
        const valid = await verifyAsync(
          new Uint8Array(sigBytes),
          new Uint8Array(lineBytes),
          new Uint8Array(pubKeyBytes)
        );
        if (!valid) {
          const seq = entry.obj["seq"] as number | undefined;
          exitError({
            ok: false,
            error: `Signature verification failed at seq ${String(seq)}`,
          });
        }
      }
    }
  }

  const receipt = buildRunReceipt({
    command: "verify-ledger",
    argsRaw: jsonArg,
    actor_id: "teo-run",
    outcome: "OK",
    exit_code: 0,
    baseDir: effectiveBaseDir,
  });
  writeRunReceipt(receipt, effectiveBaseDir);

  writeJson({ ok: true, entry_count: parsedEntries.length, chain_intact: true, run_id: receipt.run_id, sig: receipt.sig });
}

async function main(): Promise<void> {
  const [, , command, jsonArg] = process.argv;

  // T15b: no command argument → exit 1
  if (!command) {
    exitError({ error: "No command specified. Usage: teo-run <command> '<json>'" });
  }

  // validate-artifact handles its own JSON repair — bypass the strict JSON.parse below
  // so that malformed-but-repairable args (e.g. trailing commas) don't cause exit 1.
  if (command === "validate-artifact") {
    try {
      handleValidateArtifact(jsonArg ?? "{}");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      exitError({ error: message });
    }
    return;
  }

  // Parse the JSON argument
  let args: unknown;
  try {
    args = JSON.parse(jsonArg ?? "{}");
  } catch {
    exitError({ error: `Invalid JSON argument: ${jsonArg}` });
  }

  try {
    switch (command) {
      case "provision":
        await handleProvision(args, jsonArg ?? "{}");
        break;
      case "validate-plan":
        handleValidatePlan(args, jsonArg ?? "{}");
        break;
      case "sign":
        handleSign(args, jsonArg ?? "{}");
        break;
      case "ledger-append":
        handleLedgerAppend(args, jsonArg ?? "{}");
        break;
      case "ledger-close":
        handleLedgerClose(args, jsonArg ?? "{}");
        break;
      case "plan-init":
        handlePlanInit(args);
        break;
      case "evaluate-gate":
        handleEvaluateGate(args);
        break;
      case "verify-ledger":
        await handleVerifyLedger(args, jsonArg ?? "{}");
        break;
      case "verify-receipt": {
        const a = args as Record<string, unknown>;
        const run_id = a["run_id"] as string;
        const verifyBaseDir = a["baseDir"] as string | undefined;
        if (!run_id || !verifyBaseDir) {
          exitError({ error: "verify-receipt requires run_id and baseDir" });
        }
        const result = verifyRunReceipt({ run_id, baseDir: verifyBaseDir! });
        writeJson(result);
        if (!result.valid) process.exit(1);
        break;
      }
      default:
        exitError({ error: `Unknown command: ${command}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    exitError({ error: message });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  exitError({ error: message });
});
