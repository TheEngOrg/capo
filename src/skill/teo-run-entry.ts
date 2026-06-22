// =============================================================================
// teo-run-entry.ts — CLI entrypoint for TEO runtime commands (WS-GO-02)
//
// CONTRACT (CLI arg protocol):
//   node bin/teo-run.js <command> '<json-string>'
//
// COMMANDS:
//   provision       — calls provision() with JSON opts
//   validate-plan   — validates JSON against Zod PlanSchema
//   sign            — calls HmacSigner.sign() with payload
//   ledger-append   — calls AppendOnlyLedger.append()
//   ledger-close    — calls AppendOnlyLedger.close()
//   init-session    — write SESSION_START ledger event + mkdir memory dirs
//
// OUTPUT CONTRACT:
//   All stdout is a single JSON object. Errors are JSON { error: string }.
//   Exit code 0 = success, 1+ = error.
// =============================================================================

import { provision } from "../bootstrap/provision.js";
import { PlanSchema } from "../core/plan.js";
import { HmacSigner } from "../core/sign.js";
import { AppendOnlyLedger } from "../core/ledger.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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

function handleInitSession(args: unknown): void {
  const a = args as Record<string, unknown>;
  const rawCommandInput = a["command_input"] as string | undefined;
  const baseDir = a["baseDir"] as string | undefined;
  const projectDir = a["project_dir"] as string | undefined;

  // Normalize command_input: trim + lowercase, default to "unknown" if empty/whitespace.
  const normalized =
    typeof rawCommandInput === "string" && rawCommandInput.trim().length > 0
      ? rawCommandInput.trim().toLowerCase()
      : "unknown";

  // Deterministic session_id: SHA-256 of normalized input, first 16 hex chars.
  // crypto.createHash is deterministic (no randomness) — passes ledger sanitization
  // because the 16-char hex output contains only [0-9a-f], no / \ or ..
  const hex16 = crypto.createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
  const session_id = `teo-${hex16}`;

  // Resolve ledger base: injected baseDir or os.homedir()/.teo (production default)
  /* c8 ignore next */
  const resolvedBase = baseDir ?? path.join(os.homedir(), ".teo");

  // Resolved project dir: injected project_dir or cwd (production default)
  /* c8 ignore next */
  const resolvedProjectDir = projectDir ?? process.cwd();

  // Write SESSION_START LedgerEvent via AppendOnlyLedger
  const ledger = new AppendOnlyLedger({ session_id, baseDir: resolvedBase });
  ledger.append({
    session_id,
    workflow_id: session_id,
    task_id: null,
    turn_id: null,
    actor_id: "SYSTEM",
    actor_type: "SYSTEM",
    phase: "PLAN",
    verdict: null,
    detail: {
      event: "SESSION_START",
      command_input: rawCommandInput ?? null,
    },
  });

  // ADR-065: mkdir -p .claude/memory/, .claude/memory/pipeline/, .claude/memory/traces/
  // These three dirs are the allowed consumer memory dirs.
  const memoryDirs = [
    path.join(resolvedProjectDir, ".claude", "memory"),
    path.join(resolvedProjectDir, ".claude", "memory", "pipeline"),
    path.join(resolvedProjectDir, ".claude", "memory", "traces"),
  ];
  for (const dir of memoryDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // If CLAUDE_ENV_FILE is set, append TEO_SESSION_ID line to it.
  const envFile = process.env["CLAUDE_ENV_FILE"];
  if (envFile) {
    try {
      fs.appendFileSync(envFile, `TEO_SESSION_ID=${session_id}\n`, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      exitError({ error: `Failed to write TEO_SESSION_ID to CLAUDE_ENV_FILE: ${message}` });
    }
  }

  const ledgerFile = path.join(resolvedBase, "ledger", `${session_id}.jsonl`);
  writeJson({ session_id, ledger_file: ledgerFile });
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
      case "init-session":
        handleInitSession(args);
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
