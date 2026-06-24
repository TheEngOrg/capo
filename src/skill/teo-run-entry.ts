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
//
// OUTPUT CONTRACT:
//   All stdout is a single JSON object. Errors are JSON { error: string }.
//   Exit code 0 = success, 1+ = error.
// =============================================================================

import { provision } from "../bootstrap/provision.js";
import { repairJson, validateArtifact } from "../core/artifacts.js";
import { PlanSchema } from "../core/plan.js";
import { HmacSigner } from "../core/sign.js";
import { AppendOnlyLedger } from "../core/ledger.js";

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

async function handleProvision(args: unknown): Promise<void> {
  const opts = args as Parameters<typeof provision>[0];

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

  // Provision errors still exit 1 (to signal error to shell)
  if (result.status === "error") {
    writeJson(result);
    process.exit(1);
  }

  writeJson(result);

  // S8: surface revocation warning to stderr so operators see it (not buried in JSON)
  if ("warning" in result && typeof result.warning === "string") {
    process.stderr.write(`[teo] provision warning: ${result.warning}\n`);
  }
}

function handleValidatePlan(args: unknown): void {
  const parsed = PlanSchema.safeParse(args);

  if (parsed.success) {
    writeJson({ valid: true });
  } else {
    writeJson({
      valid: false,
      errors: parsed.error.issues,
    });
  }
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
  writeJson(result);
}

function handleSign(args: unknown): void {
  const a = args as Record<string, unknown>;
  const baseDir = a["baseDir"] as string | undefined;
  const keyring_id = a["keyring_id"] as string | undefined;
  const signerOpts: ConstructorParameters<typeof HmacSigner>[0] = {};
  if (baseDir !== undefined) signerOpts.baseDir = baseDir;
  if (keyring_id !== undefined) signerOpts.keyring_id = keyring_id;
  const signer = new HmacSigner(signerOpts);

  const payload = a["payload"] as Parameters<typeof signer.sign>[0];
  const signature = signer.sign(payload);

  writeJson({ signature });
}

function handleLedgerAppend(args: unknown): void {
  const a = args as Record<string, unknown>;
  const baseDir = a["baseDir"] as string | undefined;
  const ledgerOpts: ConstructorParameters<typeof AppendOnlyLedger>[0] = {
    session_id: a["session_id"] as string,
  };
  if (baseDir !== undefined) ledgerOpts.baseDir = baseDir;
  const ledger = new AppendOnlyLedger(ledgerOpts);

  const entry = a["entry"] as Parameters<typeof ledger.append>[0];
  const result = ledger.append(entry);

  writeJson(result);
}

function handleLedgerClose(args: unknown): void {
  const a = args as Record<string, unknown>;
  const baseDir = a["baseDir"] as string | undefined;
  const ledgerOpts: ConstructorParameters<typeof AppendOnlyLedger>[0] = {
    session_id: a["session_id"] as string,
  };
  if (baseDir !== undefined) ledgerOpts.baseDir = baseDir;
  const ledger = new AppendOnlyLedger(ledgerOpts);

  const summary = a["summary"] as Parameters<typeof ledger.close>[0];
  ledger.close(summary);

  writeJson({ ok: true });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
        await handleProvision(args);
        break;
      case "validate-plan":
        handleValidatePlan(args);
        break;
      case "sign":
        handleSign(args);
        break;
      case "ledger-append":
        handleLedgerAppend(args);
        break;
      case "ledger-close":
        handleLedgerClose(args);
        break;
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
