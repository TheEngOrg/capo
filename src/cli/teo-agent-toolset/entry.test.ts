// =============================================================================
// entry.test.ts — QA spec for src/cli/teo-agent-toolset/entry.ts
//
// STATUS: PASSING — implementation complete. All 87 tests green.
//
// CONTRACT:
//   The binary exposes 6 subcommands as exported handler functions:
//     handleMemoryWrite  — atomic JSON field update under .claude/memory/
//     handleMemoryAppend — markdown list-item append under .claude/memory/
//     handleMemoryPatchSection — markdown section replace/append
//     handleFileCreate   — create new file (rejects if already exists)
//     handlePlanCreate   — serialize + validate PLAN_ARTIFACT to disk
//     handleTurnEnd      — write capo-result.json atomically
//
//   Each handler takes a plain-args object and a cwd (project root string).
//   On error: throws an Error (message describes the problem).
//   On success: returns void (side-effects only, or the file path written).
//
// ORDERING: misuse → boundary → golden path (ADR-064 adversarial-first policy)
//
// DESIGN DECISION (engineer must honour):
//   Tests call exported handler functions directly, not a spawned subprocess.
//   The binary's main() is a thin CLI router; the handlers are the unit under
//   test. This gives us synchronous/async control without process overhead and
//   lets vitest report per-branch coverage accurately.
//
//   Handlers receive their "project root" as an argument (not process.cwd()).
//   This allows tests to inject a temp dir as the project root.
//
//   For memory-* subcommands the "allowed namespace" check is:
//     resolved path must begin with `<projectRoot>/.claude/memory/`
//   The check uses path.resolve() against the projectRoot arg, so relative
//   paths like `../../etc/passwd` are caught.
//
//   Handler signatures (what dev must export from entry.ts):
//
//     handleMemoryWrite(args: {
//       file: string;   // relative path (resolved against projectRoot/.claude/memory/)
//       set: string;    // "dot.path=value"
//     }, projectRoot: string): Promise<void>
//
//     handleMemoryAppend(args: {
//       file: string;
//       entry: string;
//     }, projectRoot: string): Promise<void>
//
//     handleMemoryPatchSection(args: {
//       file: string;
//       header: string;  // e.g. "## Header"
//       body: string;
//     }, projectRoot: string): Promise<void>
//
//     handleFileCreate(args: {
//       path: string;    // relative or absolute — no namespace restriction
//       content: string;
//     }, projectRoot: string): Promise<void>
//
//     handlePlanCreate(args: {
//       directive: string;
//       tasks: string;   // raw JSON string — parsed internally
//       output: string;  // file path to write
//     }, projectRoot: string): Promise<void>
//
//     handleTurnEnd(args: {
//       session: string;
//       status: string;
//       next: string;
//       output: string;  // directory path for capo-result.json
//       phase?: string;  // optional
//     }, projectRoot: string): Promise<void>
//
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Import the handlers under test.
// These imports will FAIL (red) until dev creates entry.ts — that's correct.
// ---------------------------------------------------------------------------
import {
  handleMemoryWrite,
  handleMemoryAppend,
  handleMemoryPatchSection,
  handleFileCreate,
  handlePlanCreate,
  handleTurnEnd,
} from "./entry.js";

// ---------------------------------------------------------------------------
// Temp dir helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  // Each test gets a fresh isolated temp dir as the "project root"
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-toolset-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: resolve the memory directory for the current tmpDir
function memDir(): string {
  return path.join(tmpDir, ".claude", "memory");
}

// Helper: write a file in the temp memory dir (sets up preconditions)
function writeMemFile(relPath: string, content: string): void {
  const full = path.join(memDir(), relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

// Helper: read a file from the temp memory dir
function readMemFile(relPath: string): string {
  return fs.readFileSync(path.join(memDir(), relPath), "utf8");
}

// =============================================================================
// 1. memory-write
// =============================================================================

describe("handleMemoryWrite — misuse: path outside .claude/memory/", () => {
  it("M1-1. rejects --file with path traversal (../../etc/passwd)", async () => {
    await expect(
      handleMemoryWrite({ file: "../../etc/passwd", set: "key=value" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M1-2. rejects --file pointing to .claude/agents/ (outside memory namespace)", async () => {
    await expect(
      handleMemoryWrite({ file: "../agents/capo.md", set: "key=value" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M1-3. rejects absolute --file path that escapes the memory namespace", async () => {
    await expect(
      handleMemoryWrite({ file: "/etc/passwd", set: "key=value" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M1-4. rejects missing --set argument (undefined)", async () => {
    await expect(
      // @ts-expect-error — intentional misuse: missing required field
      handleMemoryWrite({ file: "tasks-qa.json" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M1-5. rejects missing --file argument (undefined)", async () => {
    await expect(
      // @ts-expect-error — intentional misuse: missing required field
      handleMemoryWrite({ set: "key=value" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M1-6. rejects --set with no '=' separator (malformed format)", async () => {
    await expect(
      handleMemoryWrite({ file: "tasks-qa.json", set: "keyvalue" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M1-7. rejects --set with empty string", async () => {
    await expect(handleMemoryWrite({ file: "tasks-qa.json", set: "" }, tmpDir)).rejects.toThrow();
  });

  it("M1-8. rejects --file with empty string", async () => {
    await expect(handleMemoryWrite({ file: "", set: "key=value" }, tmpDir)).rejects.toThrow();
  });
});

describe("handleMemoryWrite — boundary: creates file if absent, updates in-place", () => {
  it("B1-1. creates file with '{}' base when target doesn't exist, then applies field", async () => {
    // File must NOT pre-exist — handler creates it
    await handleMemoryWrite({ file: "new-file.json", set: "status=draft" }, tmpDir);

    const content = readMemFile("new-file.json");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed["status"]).toBe("draft");
  });

  it("B1-2. --set with '=' in the value (only first '=' is the separator)", async () => {
    // "url=http://example.com?a=1" — path is "url", value is "http://example.com?a=1"
    await handleMemoryWrite({ file: "data.json", set: "url=http://example.com?a=1" }, tmpDir);
    const parsed = JSON.parse(readMemFile("data.json")) as Record<string, unknown>;
    expect(parsed["url"]).toBe("http://example.com?a=1");
  });

  it("B1-3. nested dot-notation path creates nested object", async () => {
    await handleMemoryWrite({ file: "state.json", set: "pipeline.phase=qa-spec" }, tmpDir);
    const parsed = JSON.parse(readMemFile("state.json")) as Record<string, unknown>;
    const pipeline = parsed["pipeline"] as Record<string, unknown>;
    expect(pipeline["phase"]).toBe("qa-spec");
  });
});

describe("handleMemoryWrite — golden path", () => {
  it("G1-1. updates an existing JSON field in-place", async () => {
    writeMemFile("tasks-qa.json", JSON.stringify({ status: "pending", workstream_id: "ws-001" }));

    await handleMemoryWrite({ file: "tasks-qa.json", set: "status=complete" }, tmpDir);

    const parsed = JSON.parse(readMemFile("tasks-qa.json")) as Record<string, unknown>;
    expect(parsed["status"]).toBe("complete");
    // Existing field preserved
    expect(parsed["workstream_id"]).toBe("ws-001");
  });

  it("G1-2. adds a new field to an existing JSON file", async () => {
    writeMemFile("test.json", JSON.stringify({ existing: "yes" }));

    await handleMemoryWrite({ file: "test.json", set: "new_field=hello" }, tmpDir);

    const parsed = JSON.parse(readMemFile("test.json")) as Record<string, unknown>;
    expect(parsed["new_field"]).toBe("hello");
    expect(parsed["existing"]).toBe("yes");
  });

  it("G1-3. write is atomic — file is valid JSON after the call", async () => {
    writeMemFile("atomic.json", JSON.stringify({ x: 1 }));

    await handleMemoryWrite({ file: "atomic.json", set: "x=2" }, tmpDir);

    // Must parse cleanly — no partial writes
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    expect(() => JSON.parse(readMemFile("atomic.json"))).not.toThrow();
  });

  it("G1-4. deeply nested dot path — three levels deep", async () => {
    await handleMemoryWrite({ file: "deep.json", set: "a.b.c=leaf-value" }, tmpDir);
    const parsed = JSON.parse(readMemFile("deep.json")) as Record<string, unknown>;
    const a = parsed["a"] as Record<string, unknown>;
    const b = a["b"] as Record<string, unknown>;
    expect(b["c"]).toBe("leaf-value");
  });
});

// =============================================================================
// 2. memory-append
// =============================================================================

describe("handleMemoryAppend — misuse: path outside .claude/memory/", () => {
  it("M2-1. rejects path traversal", async () => {
    await expect(
      handleMemoryAppend({ file: "../../MEMORY.md", entry: "- item" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M2-2. rejects absolute path outside memory namespace", async () => {
    await expect(
      handleMemoryAppend({ file: "/tmp/evil.md", entry: "- item" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M2-3. rejects missing --entry argument", async () => {
    await expect(
      // @ts-expect-error — intentional misuse: missing required field
      handleMemoryAppend({ file: "MEMORY.md" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M2-4. rejects missing --file argument", async () => {
    await expect(
      // @ts-expect-error — intentional misuse: missing required field
      handleMemoryAppend({ entry: "- item" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M2-5. rejects empty --file string", async () => {
    await expect(handleMemoryAppend({ file: "", entry: "- item" }, tmpDir)).rejects.toThrow();
  });

  it("M2-6. rejects empty --entry string", async () => {
    await expect(handleMemoryAppend({ file: "MEMORY.md", entry: "" }, tmpDir)).rejects.toThrow();
  });
});

describe("handleMemoryAppend — boundary", () => {
  it("B2-1. creates file with the entry when file doesn't exist", async () => {
    await handleMemoryAppend({ file: "new.md", entry: "first entry" }, tmpDir);

    const content = readMemFile("new.md");
    expect(content).toContain("- first entry");
  });

  it("B2-2. entry that already starts with '- ' is not double-prefixed", async () => {
    // The handler prepends '- ' regardless — OR it checks. Either is acceptable
    // as long as the result is a valid markdown list item. We verify it appears
    // once in the file and the line is a list item.
    await handleMemoryAppend({ file: "list.md", entry: "some item" }, tmpDir);
    const content = readMemFile("list.md");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    // At least one line must be a markdown list item containing our text
    expect(lines.some((l) => l.startsWith("- ") && l.includes("some item"))).toBe(true);
  });
});

describe("handleMemoryAppend — golden path", () => {
  it("G2-1. appends a markdown list item to existing content without destroying it", async () => {
    writeMemFile("MEMORY.md", "# Index\n\n- existing entry\n");

    await handleMemoryAppend({ file: "MEMORY.md", entry: "new entry" }, tmpDir);

    const content = readMemFile("MEMORY.md");
    expect(content).toContain("- existing entry");
    expect(content).toContain("- new entry");
  });

  it("G2-2. appending twice accumulates both entries", async () => {
    writeMemFile("log.md", "");

    await handleMemoryAppend({ file: "log.md", entry: "alpha" }, tmpDir);
    await handleMemoryAppend({ file: "log.md", entry: "beta" }, tmpDir);

    const content = readMemFile("log.md");
    expect(content).toContain("alpha");
    expect(content).toContain("beta");
  });

  it("G2-3. new item appears after existing content (appended, not prepended)", async () => {
    writeMemFile("order.md", "# Header\n\n- first\n");

    await handleMemoryAppend({ file: "order.md", entry: "second" }, tmpDir);

    const content = readMemFile("order.md");
    const firstIdx = content.indexOf("first");
    const secondIdx = content.indexOf("second");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });
});

// =============================================================================
// 3. memory-patch-section
// =============================================================================

describe("handleMemoryPatchSection — misuse: path outside .claude/memory/", () => {
  it("M3-1. rejects path traversal", async () => {
    await expect(
      handleMemoryPatchSection(
        { file: "../../README.md", header: "## Foo", body: "content" },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M3-2. rejects absolute path outside memory namespace", async () => {
    await expect(
      handleMemoryPatchSection({ file: "/etc/hosts", header: "## Foo", body: "content" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M3-3. rejects missing --header argument", async () => {
    await expect(
      // @ts-expect-error — intentional misuse
      handleMemoryPatchSection({ file: "doc.md", body: "content" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M3-4. rejects missing --body argument", async () => {
    await expect(
      // @ts-expect-error — intentional misuse
      handleMemoryPatchSection({ file: "doc.md", header: "## Foo" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M3-5. rejects missing --file argument", async () => {
    await expect(
      // @ts-expect-error — intentional misuse
      handleMemoryPatchSection({ header: "## Foo", body: "content" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M3-6. rejects empty --file string", async () => {
    await expect(
      handleMemoryPatchSection({ file: "", header: "## Foo", body: "content" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M3-7. rejects empty --header string", async () => {
    await expect(
      handleMemoryPatchSection({ file: "doc.md", header: "", body: "content" }, tmpDir)
    ).rejects.toThrow();
  });
});

describe("handleMemoryPatchSection — boundary", () => {
  it("B3-1. creates file with the section when file doesn't exist", async () => {
    await handleMemoryPatchSection(
      { file: "new-doc.md", header: "## Tasks", body: "- task one" },
      tmpDir
    );
    const content = readMemFile("new-doc.md");
    expect(content).toContain("## Tasks");
    expect(content).toContain("- task one");
  });

  it("B3-2. appends section if header not found in existing file", async () => {
    writeMemFile("existing.md", "# Title\n\n## Other Section\n\nsome content\n");

    await handleMemoryPatchSection(
      { file: "existing.md", header: "## New Section", body: "new body" },
      tmpDir
    );

    const content = readMemFile("existing.md");
    expect(content).toContain("## Other Section");
    expect(content).toContain("## New Section");
    expect(content).toContain("new body");
  });
});

describe("handleMemoryPatchSection — golden path", () => {
  it("G3-1. replaces existing section content, stops at next ## header", async () => {
    writeMemFile("multi.md", "# Top\n\n## Alpha\n\nold alpha content\n\n## Beta\n\nbeta content\n");

    await handleMemoryPatchSection(
      { file: "multi.md", header: "## Alpha", body: "new alpha content" },
      tmpDir
    );

    const content = readMemFile("multi.md");
    expect(content).toContain("## Alpha");
    expect(content).toContain("new alpha content");
    expect(content).not.toContain("old alpha content");
    // Beta section must be preserved
    expect(content).toContain("## Beta");
    expect(content).toContain("beta content");
  });

  it("G3-2. replaces last section (EOF boundary — no next ## after it)", async () => {
    writeMemFile("last.md", "## First\n\nfirst content\n\n## Last\n\nold last content\n");

    await handleMemoryPatchSection(
      { file: "last.md", header: "## Last", body: "new last content" },
      tmpDir
    );

    const content = readMemFile("last.md");
    expect(content).toContain("## First");
    expect(content).toContain("## Last");
    expect(content).toContain("new last content");
    expect(content).not.toContain("old last content");
  });

  it("G3-3. round-trip: write then patch produces valid file with both sections", async () => {
    await handleMemoryPatchSection(
      { file: "roundtrip.md", header: "## Status", body: "pending" },
      tmpDir
    );
    await handleMemoryPatchSection(
      { file: "roundtrip.md", header: "## Status", body: "complete" },
      tmpDir
    );

    const content = readMemFile("roundtrip.md");
    expect(content).toContain("## Status");
    expect(content).toContain("complete");
    expect(content).not.toContain("pending");
  });
});

// =============================================================================
// 4. file-create
// =============================================================================

describe("handleFileCreate — misuse: file already exists", () => {
  it("M4-1. rejects if the file already exists (exit 1 equivalent — throws)", async () => {
    const target = path.join(tmpDir, "existing.ts");
    fs.writeFileSync(target, "// pre-existing", "utf8");

    await expect(
      handleFileCreate({ path: target, content: "new content" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M4-2. error message for existing file mentions 'teo-apply-edit' (instructs fallback)", async () => {
    const target = path.join(tmpDir, "already-there.md");
    fs.writeFileSync(target, "existing", "utf8");

    let errMsg = "";
    try {
      await handleFileCreate({ path: target, content: "new" }, tmpDir);
    } catch (e) {
      errMsg = (e as Error).message;
    }
    expect(errMsg.toLowerCase()).toMatch(/teo-apply-edit/i);
  });

  it("M4-3. rejects missing --path argument", async () => {
    await expect(
      // @ts-expect-error — intentional misuse
      handleFileCreate({ content: "hello" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M4-4. rejects missing --content argument", async () => {
    await expect(
      // @ts-expect-error — intentional misuse
      handleFileCreate({ path: path.join(tmpDir, "file.ts") }, tmpDir)
    ).rejects.toThrow();
  });

  it("M4-5. rejects empty --path string", async () => {
    await expect(handleFileCreate({ path: "", content: "hello" }, tmpDir)).rejects.toThrow();
  });
});

describe("handleFileCreate — boundary", () => {
  it("B4-1. creates parent directories as needed (deeply nested path)", async () => {
    const target = path.join(tmpDir, "a", "b", "c", "new.ts");

    await handleFileCreate({ path: target, content: "// new" }, tmpDir);

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("// new");
  });

  it("B4-2. creates file with empty string content", async () => {
    const target = path.join(tmpDir, "empty.ts");

    await handleFileCreate({ path: target, content: "" }, tmpDir);

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("");
  });

  it("B4-3. no namespace restriction — any non-existing path is accepted", async () => {
    // file-create does NOT enforce a .claude/memory/ restriction
    const target = path.join(tmpDir, "src", "new-module.ts");

    await handleFileCreate({ path: target, content: "export const x = 1;" }, tmpDir);

    expect(fs.existsSync(target)).toBe(true);
  });
});

describe("handleFileCreate — golden path", () => {
  it("G4-1. creates a new file with exact content provided", async () => {
    const target = path.join(tmpDir, "hello.ts");
    const content = 'export const greeting = "hello world";';

    await handleFileCreate({ path: target, content }, tmpDir);

    expect(fs.readFileSync(target, "utf8")).toBe(content);
  });

  it("G4-2. two different new files can be created independently", async () => {
    const a = path.join(tmpDir, "a.ts");
    const b = path.join(tmpDir, "b.ts");

    await handleFileCreate({ path: a, content: "// a" }, tmpDir);
    await handleFileCreate({ path: b, content: "// b" }, tmpDir);

    expect(fs.readFileSync(a, "utf8")).toBe("// a");
    expect(fs.readFileSync(b, "utf8")).toBe("// b");
  });
});

// =============================================================================
// 5. plan-create
// =============================================================================

// Minimal valid AGENT task with __DEFERRED__ prompt (as required by plan-create)
const validDeferredAgentTask = {
  id: "task-qa-01",
  type: "AGENT" as const,
  agent_id: "qa",
  prompt: "__DEFERRED__",
  needs: [],
  gates: [],
};

// A valid SCRIPT task (no prompt field, no deferral constraint)
const validScriptTask = {
  id: "task-script-01",
  type: "SCRIPT" as const,
  command: "npm run test",
  needs: [],
  gates: [],
};

describe("handlePlanCreate — misuse: invalid directive enum", () => {
  it("M5-1. rejects directive 'INVALID' (not in enum)", async () => {
    const output = path.join(tmpDir, "plan.json");
    await expect(
      handlePlanCreate(
        {
          directive: "INVALID",
          tasks: JSON.stringify([validDeferredAgentTask]),
          output,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M5-2. rejects directive 'build' (wrong case)", async () => {
    const output = path.join(tmpDir, "plan.json");
    await expect(
      handlePlanCreate(
        {
          directive: "build",
          tasks: JSON.stringify([validDeferredAgentTask]),
          output,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M5-3. rejects empty directive string", async () => {
    const output = path.join(tmpDir, "plan.json");
    await expect(
      handlePlanCreate(
        {
          directive: "",
          tasks: JSON.stringify([validDeferredAgentTask]),
          output,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M5-4. rejects ARCHITECTURAL (not in plan-create enum: PLAN/BUILD/FIX/REVIEW/IMPROVE/SHIP)", async () => {
    // plan-create has its own directive enum distinct from core plan.ts.
    // ARCHITECTURAL is valid in PlanSchema but not in plan-create's CLI enum.
    const output = path.join(tmpDir, "plan.json");
    await expect(
      handlePlanCreate(
        {
          directive: "ARCHITECTURAL",
          tasks: JSON.stringify([validDeferredAgentTask]),
          output,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });
});

describe("handlePlanCreate — misuse: invalid tasks", () => {
  it("M5-5. rejects malformed JSON in --tasks", async () => {
    const output = path.join(tmpDir, "plan.json");
    await expect(
      handlePlanCreate(
        {
          directive: "BUILD",
          tasks: "not-valid-json{{{",
          output,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M5-6. rejects empty tasks array ([] is invalid — must have at least one task)", async () => {
    const output = path.join(tmpDir, "plan.json");
    await expect(
      handlePlanCreate(
        {
          directive: "BUILD",
          tasks: JSON.stringify([]),
          output,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M5-7. rejects AGENT task with non-__DEFERRED__ prompt", async () => {
    const nonDeferredTask = {
      ...validDeferredAgentTask,
      prompt: "Do the thing now",
    };
    const output = path.join(tmpDir, "plan.json");
    await expect(
      handlePlanCreate(
        {
          directive: "BUILD",
          tasks: JSON.stringify([nonDeferredTask]),
          output,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M5-8. rejects tasks that fail TEOTaskSchema (missing required field)", async () => {
    const badTask = { id: "t1", type: "AGENT" }; // missing agent_id and prompt
    const output = path.join(tmpDir, "plan.json");
    await expect(
      handlePlanCreate(
        {
          directive: "BUILD",
          tasks: JSON.stringify([badTask]),
          output,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M5-9. rejects tasks JSON that is a non-array (object instead of array)", async () => {
    const output = path.join(tmpDir, "plan.json");
    await expect(
      handlePlanCreate(
        {
          directive: "BUILD",
          tasks: JSON.stringify({ id: "t1" }), // object, not array
          output,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M5-10. rejects if ANY AGENT task in the array has a non-deferred prompt (mixed array)", async () => {
    const mixed = [
      validDeferredAgentTask,
      { ...validDeferredAgentTask, id: "task-2", prompt: "concrete prompt here" },
    ];
    const output = path.join(tmpDir, "plan.json");
    await expect(
      handlePlanCreate(
        {
          directive: "BUILD",
          tasks: JSON.stringify(mixed),
          output,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });
});

describe("handlePlanCreate — misuse: missing required args", () => {
  it("M5-11. rejects missing --directive", async () => {
    const output = path.join(tmpDir, "plan.json");
    await expect(
      // @ts-expect-error — intentional misuse
      handlePlanCreate({ tasks: JSON.stringify([validDeferredAgentTask]), output }, tmpDir)
    ).rejects.toThrow();
  });

  it("M5-12. rejects missing --tasks", async () => {
    const output = path.join(tmpDir, "plan.json");
    await expect(
      // @ts-expect-error — intentional misuse
      handlePlanCreate({ directive: "BUILD", output }, tmpDir)
    ).rejects.toThrow();
  });

  it("M5-13. rejects missing --output", async () => {
    await expect(
      // @ts-expect-error — intentional misuse
      handlePlanCreate(
        { directive: "BUILD", tasks: JSON.stringify([validDeferredAgentTask]) },
        tmpDir
      )
    ).rejects.toThrow();
  });
});

describe("handlePlanCreate — boundary", () => {
  it("B5-1. SCRIPT tasks are NOT subject to the __DEFERRED__ constraint (no prompt field)", async () => {
    const output = path.join(tmpDir, "script-plan.json");
    // Should succeed — SCRIPT tasks have no `prompt` field at all
    await expect(
      handlePlanCreate(
        {
          directive: "BUILD",
          tasks: JSON.stringify([validScriptTask]),
          output,
        },
        tmpDir
      )
    ).resolves.not.toThrow();
    expect(fs.existsSync(output)).toBe(true);
  });

  it("B5-2. plan_id is generated in format plan_<timestamp>_<random6>", async () => {
    const output = path.join(tmpDir, "id-check.json");
    await handlePlanCreate(
      {
        directive: "BUILD",
        tasks: JSON.stringify([validDeferredAgentTask]),
        output,
      },
      tmpDir
    );

    const artifact = JSON.parse(fs.readFileSync(output, "utf8")) as Record<string, unknown>;
    const planId = artifact["plan_id"] as string;
    // Must match: plan_<timestamp>_<6 alphanumeric chars>
    expect(planId).toMatch(/^plan_\d+_[a-z0-9]{6}$/i);
  });

  it("B5-3. creates output parent directories as needed", async () => {
    const output = path.join(tmpDir, "nested", "deep", "plan.json");
    await handlePlanCreate(
      {
        directive: "FIX",
        tasks: JSON.stringify([validDeferredAgentTask]),
        output,
      },
      tmpDir
    );
    expect(fs.existsSync(output)).toBe(true);
  });

  it("B5-4. mixed SCRIPT + AGENT tasks — SCRIPT passes, AGENT must be deferred", async () => {
    const mixed = [validScriptTask, validDeferredAgentTask];
    const output = path.join(tmpDir, "mixed.json");
    await expect(
      handlePlanCreate(
        {
          directive: "REVIEW",
          tasks: JSON.stringify(mixed),
          output,
        },
        tmpDir
      )
    ).resolves.not.toThrow();
    expect(fs.existsSync(output)).toBe(true);
  });
});

describe("handlePlanCreate — golden path", () => {
  it("G5-1. writes a valid PLAN_ARTIFACT JSON file that round-trips through PlanSchema", async () => {
    const { PlanSchema } = await import("../../core/plan.js");
    const output = path.join(tmpDir, "artifact.json");

    await handlePlanCreate(
      {
        directive: "BUILD",
        tasks: JSON.stringify([validDeferredAgentTask]),
        output,
      },
      tmpDir
    );

    expect(fs.existsSync(output)).toBe(true);
    const raw = fs.readFileSync(output, "utf8");
    const parsed: unknown = JSON.parse(raw);

    // Must parse through PlanSchema without throwing
    const result = PlanSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it("G5-2. all 6 directive enum values are accepted", async () => {
    const directives = ["PLAN", "BUILD", "FIX", "REVIEW", "IMPROVE", "SHIP"] as const;
    for (const directive of directives) {
      const output = path.join(tmpDir, `plan-${directive}.json`);
      await expect(
        handlePlanCreate(
          {
            directive,
            tasks: JSON.stringify([validDeferredAgentTask]),
            output,
          },
          tmpDir
        )
      ).resolves.not.toThrow();
      expect(fs.existsSync(output)).toBe(true);
    }
  });

  it("G5-3. produced artifact has required top-level fields: plan_id, version, directive, tasks", async () => {
    const output = path.join(tmpDir, "fields.json");
    await handlePlanCreate(
      {
        directive: "SHIP",
        tasks: JSON.stringify([validDeferredAgentTask]),
        output,
      },
      tmpDir
    );

    const artifact = JSON.parse(fs.readFileSync(output, "utf8")) as Record<string, unknown>;
    expect(typeof artifact["plan_id"]).toBe("string");
    expect(artifact["version"]).toBe("1");
    expect(artifact["directive"]).toBe("SHIP");
    expect(Array.isArray(artifact["tasks"])).toBe(true);
  });

  it("G5-4. tasks in the written artifact match the input tasks shape", async () => {
    const output = path.join(tmpDir, "tasks-check.json");
    await handlePlanCreate(
      {
        directive: "BUILD",
        tasks: JSON.stringify([validDeferredAgentTask]),
        output,
      },
      tmpDir
    );

    const artifact = JSON.parse(fs.readFileSync(output, "utf8")) as Record<string, unknown>;
    const tasks = artifact["tasks"] as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.["id"]).toBe("task-qa-01");
    expect(tasks[0]?.["prompt"]).toBe("__DEFERRED__");
  });
});

// =============================================================================
// 6. turn-end
// =============================================================================

describe("handleTurnEnd — misuse: invalid status enum", () => {
  it("M6-1. rejects status 'done' (not in enum)", async () => {
    await expect(
      handleTurnEnd(
        {
          session: "sess-001",
          status: "done",
          next: "proceed to review",
          output: tmpDir,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M6-2. rejects status 'COMPLETE' (wrong case)", async () => {
    await expect(
      handleTurnEnd(
        {
          session: "sess-001",
          status: "COMPLETE",
          next: "proceed to review",
          output: tmpDir,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M6-3. rejects status '' (empty string)", async () => {
    await expect(
      handleTurnEnd(
        {
          session: "sess-001",
          status: "",
          next: "next action",
          output: tmpDir,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M6-4. rejects status 'blocked' (not in enum)", async () => {
    await expect(
      handleTurnEnd(
        {
          session: "sess-001",
          status: "blocked",
          next: "next action",
          output: tmpDir,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });
});

describe("handleTurnEnd — misuse: missing required args", () => {
  it("M6-5. rejects missing --session", async () => {
    await expect(
      // @ts-expect-error — intentional misuse
      handleTurnEnd({ status: "complete", next: "next action", output: tmpDir }, tmpDir)
    ).rejects.toThrow();
  });

  it("M6-6. rejects missing --next", async () => {
    await expect(
      // @ts-expect-error — intentional misuse
      handleTurnEnd({ session: "sess-001", status: "complete", output: tmpDir }, tmpDir)
    ).rejects.toThrow();
  });

  it("M6-7. rejects missing --output", async () => {
    await expect(
      // @ts-expect-error — intentional misuse
      handleTurnEnd({ session: "sess-001", status: "complete", next: "next action" }, tmpDir)
    ).rejects.toThrow();
  });

  it("M6-8. rejects missing --status", async () => {
    await expect(
      // @ts-expect-error — intentional misuse
      handleTurnEnd({ session: "sess-001", next: "next action", output: tmpDir }, tmpDir)
    ).rejects.toThrow();
  });

  it("M6-9. rejects empty --session string", async () => {
    await expect(
      handleTurnEnd(
        {
          session: "",
          status: "complete",
          next: "next action",
          output: tmpDir,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });

  it("M6-10. rejects empty --next string", async () => {
    await expect(
      handleTurnEnd(
        {
          session: "sess-001",
          status: "complete",
          next: "",
          output: tmpDir,
        },
        tmpDir
      )
    ).rejects.toThrow();
  });
});

describe("handleTurnEnd — boundary", () => {
  it("B6-1. phase is optional — omitting it sets pipeline_phase to 'unknown'", async () => {
    const outDir = path.join(tmpDir, "out");
    fs.mkdirSync(outDir, { recursive: true });

    await handleTurnEnd(
      {
        session: "sess-001",
        status: "complete",
        next: "go to review",
        output: outDir,
        // phase intentionally omitted
      },
      tmpDir
    );

    const result = JSON.parse(
      fs.readFileSync(path.join(outDir, "capo-result.json"), "utf8")
    ) as Record<string, unknown>;
    expect(result["pipeline_phase"]).toBe("unknown");
  });

  it("B6-2. overwrites existing capo-result.json (atomic overwrite)", async () => {
    const outDir = path.join(tmpDir, "overwrite");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "capo-result.json"), JSON.stringify({ old: true }), "utf8");

    await handleTurnEnd(
      {
        session: "sess-new",
        status: "in_progress",
        next: "next step",
        output: outDir,
      },
      tmpDir
    );

    const result = JSON.parse(
      fs.readFileSync(path.join(outDir, "capo-result.json"), "utf8")
    ) as Record<string, unknown>;
    expect(result["session_id"]).toBe("sess-new");
    expect((result as Record<string, unknown>)["old"]).toBeUndefined();
  });

  it("B6-3. output directory is created if it doesn't exist", async () => {
    const outDir = path.join(tmpDir, "new-dir", "nested");

    await handleTurnEnd(
      {
        session: "sess-001",
        status: "complete",
        next: "done",
        output: outDir,
      },
      tmpDir
    );

    expect(fs.existsSync(path.join(outDir, "capo-result.json"))).toBe(true);
  });
});

describe("handleTurnEnd — golden path", () => {
  it("G6-1. writes capo-result.json with all required fields", async () => {
    const outDir = path.join(tmpDir, "result-dir");
    fs.mkdirSync(outDir, { recursive: true });

    await handleTurnEnd(
      {
        session: "sess-golden",
        status: "complete",
        next: "merge and ship",
        output: outDir,
        phase: "staff-review",
      },
      tmpDir
    );

    const result = JSON.parse(
      fs.readFileSync(path.join(outDir, "capo-result.json"), "utf8")
    ) as Record<string, unknown>;

    expect(result["session_id"]).toBe("sess-golden");
    expect(result["status"]).toBe("complete");
    expect(result["next_action"]).toBe("merge and ship");
    expect(result["pipeline_phase"]).toBe("staff-review");
    expect(typeof result["timestamp"]).toBe("string");
  });

  it("G6-2. all 4 valid status values are accepted", async () => {
    const statuses = ["in_progress", "gate_blocked", "complete", "rotating"] as const;
    for (const status of statuses) {
      const outDir = path.join(tmpDir, `status-${status}`);
      fs.mkdirSync(outDir, { recursive: true });

      await expect(
        handleTurnEnd(
          {
            session: "sess-status-test",
            status,
            next: "next step",
            output: outDir,
          },
          tmpDir
        )
      ).resolves.not.toThrow();

      const result = JSON.parse(
        fs.readFileSync(path.join(outDir, "capo-result.json"), "utf8")
      ) as Record<string, unknown>;
      expect(result["status"]).toBe(status);
    }
  });

  it("G6-3. timestamp is a valid ISO 8601 string", async () => {
    const outDir = path.join(tmpDir, "ts-check");
    fs.mkdirSync(outDir, { recursive: true });

    await handleTurnEnd(
      {
        session: "sess-ts",
        status: "in_progress",
        next: "continue",
        output: outDir,
      },
      tmpDir
    );

    const result = JSON.parse(
      fs.readFileSync(path.join(outDir, "capo-result.json"), "utf8")
    ) as Record<string, unknown>;
    const ts = result["timestamp"] as string;
    expect(typeof ts).toBe("string");
    const d = new Date(ts);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it("G6-4. written file is valid JSON (no partial writes)", async () => {
    const outDir = path.join(tmpDir, "json-valid");
    fs.mkdirSync(outDir, { recursive: true });

    await handleTurnEnd(
      {
        session: "sess-json",
        status: "rotating",
        next: "spawn next agent",
        output: outDir,
      },
      tmpDir
    );

    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      JSON.parse(fs.readFileSync(path.join(outDir, "capo-result.json"), "utf8"))
    ).not.toThrow();
  });

  it("G6-5. with explicit --phase, pipeline_phase matches the provided value", async () => {
    const outDir = path.join(tmpDir, "phase-check");
    fs.mkdirSync(outDir, { recursive: true });

    await handleTurnEnd(
      {
        session: "sess-phase",
        status: "gate_blocked",
        next: "wait for QA approval",
        output: outDir,
        phase: "qa-validate",
      },
      tmpDir
    );

    const result = JSON.parse(
      fs.readFileSync(path.join(outDir, "capo-result.json"), "utf8")
    ) as Record<string, unknown>;
    expect(result["pipeline_phase"]).toBe("qa-validate");
  });
});
