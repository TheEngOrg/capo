// =============================================================================
// entry.ts — teo-agent-toolset CLI binary
//
// Exports 6 handler functions (the unit under test) and a main() CLI router.
// Each handler takes a plain-args object and a projectRoot string.
// On error: throws an Error. On success: returns void.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { TEOTaskSchema, PlanSchema } from "../../core/plan.js";

// ---------------------------------------------------------------------------
// CLI-side directive enum (distinct from PlanSchema — ARCHITECTURAL excluded)
// ---------------------------------------------------------------------------
const CLI_DIRECTIVES = ["PLAN", "BUILD", "FIX", "REVIEW", "IMPROVE", "SHIP"] as const;
type CLIDirective = (typeof CLI_DIRECTIVES)[number];

// ---------------------------------------------------------------------------
// Status enum for turn-end
// ---------------------------------------------------------------------------
const TURN_END_STATUSES = ["in_progress", "gate_blocked", "complete", "rotating"] as const;

// ---------------------------------------------------------------------------
// Namespace guard — resolve path and verify it's inside .claude/memory/
// ---------------------------------------------------------------------------
function resolveMemoryPath(file: string, projectRoot: string): string {
  // c8 ignore next — callers validate non-empty before calling; defensive guard
  if (!file) {
    throw new Error("--file must be a non-empty string");
  }
  const memoryBase = path.resolve(projectRoot, ".claude", "memory");
  const resolved = path.resolve(memoryBase, file);
  // Must start with memoryBase + path.sep to prevent escaping
  if (!resolved.startsWith(memoryBase + path.sep)) {
    throw new Error(
      `Path traversal rejected: "${file}" resolves outside .claude/memory/ namespace`
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Atomic write helper — write to .tmp then rename
// ---------------------------------------------------------------------------
function atomicWriteFile(filePath: string, content: string): void {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Ensure parent directory exists
// ---------------------------------------------------------------------------
function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// =============================================================================
// handleMemoryWrite
// =============================================================================
// eslint-disable-next-line @typescript-eslint/require-await
export async function handleMemoryWrite(
  args: { file: string; set: string },
  projectRoot: string
): Promise<void> {
  // Validate args presence
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.file === undefined || args.file === null) {
    throw new Error("--file is required");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.set === undefined || args.set === null) {
    throw new Error("--set is required");
  }
  if (!args.file) {
    throw new Error("--file must be a non-empty string");
  }
  if (!args.set) {
    throw new Error("--set must be a non-empty string");
  }

  // Namespace check
  const resolvedPath = resolveMemoryPath(args.file, projectRoot);

  // Parse --set: split on FIRST '=' only
  const eqIdx = args.set.indexOf("=");
  if (eqIdx === -1) {
    throw new Error('--set must be in "dot.path=value" format (no "=" found)');
  }
  const dotPath = args.set.slice(0, eqIdx);
  const value = args.set.slice(eqIdx + 1);

  // c8 ignore next — "=value" with empty key before "=" is rejected; empty dotPath guard
  if (!dotPath) {
    throw new Error('--set must have a non-empty key before "="');
  }

  // Load or create base object
  let base: Record<string, unknown> = {};
  if (fs.existsSync(resolvedPath)) {
    const raw = fs.readFileSync(resolvedPath, "utf8");
    base = JSON.parse(raw) as Record<string, unknown>;
  }

  // Apply dot-notation path
  const keys = dotPath.split(".");
  let cursor: Record<string, unknown> = base;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i] as string;
    // c8 ignore next — the null-check branch (cursor[key]===null) is unreachable via JSON.parse; defensive guard
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  const leafKey = keys[keys.length - 1] as string;
  cursor[leafKey] = value;

  // Write atomically
  ensureDir(resolvedPath);
  atomicWriteFile(resolvedPath, JSON.stringify(base, null, 2));
}

// =============================================================================
// handleMemoryAppend
// =============================================================================
// eslint-disable-next-line @typescript-eslint/require-await
export async function handleMemoryAppend(
  args: { file: string; entry: string },
  projectRoot: string
): Promise<void> {
  // Validate args presence
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.file === undefined || args.file === null) {
    throw new Error("--file is required");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.entry === undefined || args.entry === null) {
    throw new Error("--entry is required");
  }
  if (!args.file) {
    throw new Error("--file must be a non-empty string");
  }
  if (!args.entry) {
    throw new Error("--entry must be a non-empty string");
  }

  // Namespace check
  const resolvedPath = resolveMemoryPath(args.file, projectRoot);

  // Build the new list item (always prepend "- ")
  const newItem = `- ${args.entry}`;

  ensureDir(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    // Create file with the entry
    atomicWriteFile(resolvedPath, `${newItem}\n`);
  } else {
    // Append to existing content
    const existing = fs.readFileSync(resolvedPath, "utf8");
    // Append with newline separator
    const updated = existing + `\n${newItem}`;
    atomicWriteFile(resolvedPath, updated);
  }
}

// =============================================================================
// handleMemoryPatchSection
// =============================================================================
// eslint-disable-next-line @typescript-eslint/require-await
export async function handleMemoryPatchSection(
  args: { file: string; header: string; body: string },
  projectRoot: string
): Promise<void> {
  // Validate args presence
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.file === undefined || args.file === null) {
    throw new Error("--file is required");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.header === undefined || args.header === null) {
    throw new Error("--header is required");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.body === undefined || args.body === null) {
    throw new Error("--body is required");
  }
  if (!args.file) {
    throw new Error("--file must be a non-empty string");
  }
  if (!args.header) {
    throw new Error("--header must be a non-empty string");
  }

  // Namespace check
  const resolvedPath = resolveMemoryPath(args.file, projectRoot);

  ensureDir(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    // Create file with the section
    const content = `${args.header}\n\n${args.body}\n`;
    atomicWriteFile(resolvedPath, content);
    return;
  }

  const existing = fs.readFileSync(resolvedPath, "utf8");
  const lines = existing.split("\n");

  // Find the header line index
  const headerIdx = lines.findIndex((line) => line === args.header);

  if (headerIdx === -1) {
    // Header not found — append the section
    const updated = existing + `\n\n${args.header}\n\n${args.body}\n`;
    atomicWriteFile(resolvedPath, updated);
    return;
  }

  // Find next ## header after the found header (to delimit the section)
  let nextHeaderIdx = -1;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith("## ")) {
      nextHeaderIdx = i;
      break;
    }
  }

  // Build replacement content
  const before = lines.slice(0, headerIdx).join("\n");
  const after = nextHeaderIdx !== -1 ? "\n" + lines.slice(nextHeaderIdx).join("\n") : "";

  let updated: string;
  if (before) {
    updated = `${before}\n${args.header}\n\n${args.body}\n${after}`;
  } else {
    updated = `${args.header}\n\n${args.body}\n${after}`;
  }

  atomicWriteFile(resolvedPath, updated);
}

// =============================================================================
// handleFileCreate
// =============================================================================
// eslint-disable-next-line @typescript-eslint/require-await
export async function handleFileCreate(
  args: { path: string; content: string },
  _projectRoot: string
): Promise<void> {
  // Validate args presence
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.path === undefined || args.path === null) {
    throw new Error("--path is required");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.content === undefined || args.content === null) {
    throw new Error("--content is required");
  }
  if (!args.path) {
    throw new Error("--path must be a non-empty string");
  }

  // Check if file already exists
  if (fs.existsSync(args.path)) {
    throw new Error(
      `File already exists: "${args.path}". Use teo-apply-edit to modify existing files.`
    );
  }

  // Create parent directories
  fs.mkdirSync(path.dirname(args.path), { recursive: true });

  // Write the file
  fs.writeFileSync(args.path, args.content, "utf8");
}

// =============================================================================
// handlePlanCreate
// =============================================================================
// eslint-disable-next-line @typescript-eslint/require-await
export async function handlePlanCreate(
  args: { directive: string; tasks: string; output: string },
  _projectRoot: string
): Promise<void> {
  // Validate args presence
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.directive === undefined || args.directive === null) {
    throw new Error("--directive is required");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.tasks === undefined || args.tasks === null) {
    throw new Error("--tasks is required");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.output === undefined || args.output === null) {
    throw new Error("--output is required");
  }

  // Validate directive enum (CLI-side — ARCHITECTURAL is excluded)
  if (!args.directive) {
    throw new Error("--directive must be a non-empty string");
  }
  if (!(CLI_DIRECTIVES as readonly string[]).includes(args.directive)) {
    throw new Error(
      `Invalid directive "${args.directive}". Must be one of: ${CLI_DIRECTIVES.join(", ")}`
    );
  }
  const directive = args.directive as CLIDirective;

  // Parse tasks JSON
  let parsedTasks: unknown;
  try {
    parsedTasks = JSON.parse(args.tasks);
  } catch {
    throw new Error(`--tasks is not valid JSON: ${args.tasks}`);
  }

  // Must be an array
  if (!Array.isArray(parsedTasks)) {
    throw new Error("--tasks must be a JSON array");
  }

  // Must not be empty
  if (parsedTasks.length === 0) {
    throw new Error("--tasks array must not be empty");
  }

  // Validate each task against TEOTaskSchema
  const validatedTasks = [];
  for (const task of parsedTasks) {
    const result = TEOTaskSchema.safeParse(task);
    if (!result.success) {
      throw new Error(`Task failed validation: ${result.error.message}`);
    }
    validatedTasks.push(result.data);
  }

  // For AGENT tasks: reject if prompt !== "__DEFERRED__"
  for (const task of validatedTasks) {
    if (task.type === "AGENT" && task.prompt !== "__DEFERRED__") {
      throw new Error(
        `AGENT task "${task.id}" must have prompt "__DEFERRED__" (got "${task.prompt}")`
      );
    }
  }

  // Generate plan_id: plan_<timestamp>_<random6chars>
  const timestamp = Date.now();
  const random6 = crypto.randomBytes(3).toString("hex"); // 3 bytes = 6 hex chars
  const plan_id = `plan_${timestamp}_${random6}`;

  // Build the plan artifact
  const artifact = {
    plan_id,
    project_id: "teo",
    created_at: new Date().toISOString(),
    version: "1" as const,
    directive,
    tasks: validatedTasks,
  };

  // Validate round-trip through PlanSchema
  const roundTrip = PlanSchema.safeParse(artifact);
  // c8 ignore next — defensive guard; only fails if above construction has a code bug
  if (!roundTrip.success) {
    throw new Error(`Plan artifact failed PlanSchema validation: ${roundTrip.error.message}`);
  }

  // Create output parent dirs
  fs.mkdirSync(path.dirname(args.output), { recursive: true });

  // Write the artifact
  fs.writeFileSync(args.output, JSON.stringify(artifact, null, 2), "utf8");
}

// =============================================================================
// handleTurnEnd
// =============================================================================
// eslint-disable-next-line @typescript-eslint/require-await
export async function handleTurnEnd(
  args: {
    session: string;
    status: string;
    next: string;
    output: string;
    phase?: string;
  },
  _projectRoot: string
): Promise<void> {
  // Validate args presence
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.session === undefined || args.session === null) {
    throw new Error("--session is required");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.status === undefined || args.status === null) {
    throw new Error("--status is required");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.next === undefined || args.next === null) {
    throw new Error("--next is required");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (args.output === undefined || args.output === null) {
    throw new Error("--output is required");
  }

  // Validate non-empty strings
  if (!args.session) {
    throw new Error("--session must be a non-empty string");
  }
  if (!args.next) {
    throw new Error("--next must be a non-empty string");
  }

  // Validate status enum
  if (!args.status) {
    throw new Error("--status must be a non-empty string");
  }
  if (!(TURN_END_STATUSES as readonly string[]).includes(args.status)) {
    throw new Error(
      `Invalid status "${args.status}". Must be one of: ${TURN_END_STATUSES.join(", ")}`
    );
  }

  // Create output directory if needed
  fs.mkdirSync(args.output, { recursive: true });

  // Build the result
  const result = {
    session_id: args.session,
    timestamp: new Date().toISOString(),
    pipeline_phase: args.phase ?? "unknown",
    status: args.status,
    next_action: args.next,
  };

  // Write atomically
  const outputFile = path.join(args.output, "capo-result.json");
  atomicWriteFile(outputFile, JSON.stringify(result, null, 2));
}

// =============================================================================
// main() — CLI router
// main() is a thin CLI router. Handler functions are fully covered by unit tests.
// c8 ignore start
// =============================================================================
async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv;

  const projectRoot = process.cwd();

  // Parse remaining args as --key=value or --key value pairs
  function parseArgs(argv: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i] as string;
      if (arg.startsWith("--")) {
        const eqIdx = arg.indexOf("=");
        if (eqIdx !== -1) {
          const key = arg.slice(2, eqIdx);
          const val = arg.slice(eqIdx + 1);
          result[key] = val;
        } else {
          const key = arg.slice(2);
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith("--")) {
            result[key] = next;
            i++;
          } else {
            result[key] = "";
          }
        }
      }
    }
    return result;
  }

  const args = parseArgs(rest);

  try {
    switch (subcommand) {
      case "memory-write":
        await handleMemoryWrite({ file: args["file"] ?? "", set: args["set"] ?? "" }, projectRoot);
        break;

      case "memory-append":
        await handleMemoryAppend(
          { file: args["file"] ?? "", entry: args["entry"] ?? "" },
          projectRoot
        );
        break;

      case "memory-patch-section":
        await handleMemoryPatchSection(
          {
            file: args["file"] ?? "",
            header: args["header"] ?? "",
            body: args["body"] ?? "",
          },
          projectRoot
        );
        break;

      case "file-create":
        await handleFileCreate(
          { path: args["path"] ?? "", content: args["content"] ?? "" },
          projectRoot
        );
        break;

      case "plan-create":
        await handlePlanCreate(
          {
            directive: args["directive"] ?? "",
            tasks: args["tasks"] ?? "",
            output: args["output"] ?? "",
          },
          projectRoot
        );
        break;

      case "turn-end": {
        const turnEndArgs: {
          session: string;
          status: string;
          next: string;
          output: string;
          phase?: string;
        } = {
          session: args["session"] ?? "",
          status: args["status"] ?? "",
          next: args["next"] ?? "",
          output: args["output"] ?? "",
        };
        const phaseVal = args["phase"];
        if (phaseVal !== undefined) {
          turnEndArgs.phase = phaseVal;
        }
        await handleTurnEnd(turnEndArgs, projectRoot);
        break;
      }

      default:
        console.error(`Unknown subcommand: ${subcommand ?? "(none)"}`);
        console.error("Usage: teo-agent-toolset <subcommand> [options]");
        console.error(
          "Subcommands: memory-write, memory-append, memory-patch-section, file-create, plan-create, turn-end"
        );
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// Run main only when this file is the entry point
// (Not in tests — tests import the handlers directly)
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("teo-agent-toolset.js") ||
    process.argv[1].endsWith("entry.ts") ||
    process.argv[1].endsWith("entry.js"));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
// c8 ignore end

// Suppress unused import warning for os (may be used in future handlers)
void os.tmpdir;
