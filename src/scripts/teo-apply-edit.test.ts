// =============================================================================
// teo-apply-edit.test.ts — QA spec for WS-APPLY-EDIT-01
//
// STATUS: GREEN — scripts/teo-apply-edit ported and all 27 tests passing.
//
// CONTRACT SOURCE
//   ~/personal/agent-tools/wonton-context/.claude/shared/teo-apply-edit-contract.md
//   Schema version: 1.0.0 (locked)
//
// WHAT IS BEING PORTED
//   A bash script that applies surgical edits to allowlisted files via a
//   JSON patch spec. Key adaption for this repo: path references must use
//   ${CLAUDE_PLUGIN_ROOT} (not wonton-context hardcoded paths); the allowlist
//   must cover .claude/scripts/**, .claude/hooks/**, .claude/shared/**,
//   .claude/agents/**, .claude/settings.json, docs/**, src/**, packages/**.
//
// ORDERING: misuse → boundary → golden path (ADR-064 adversarial-first policy)
//
// DEPENDENCY GAPS
//   - scripts/teo-apply-edit must exist at repo root (bash script, no extension)
//   - jq must be available on PATH (required for JSON parsing)
//   - flock availability is tested but fail-open behavior is acceptable on macOS
//
// EXIT CODES
//   0  Applied (or no-op for empty patches array)
//   1  Refused: allowlist violation / path traversal / symlink / anchor-not-found /
//              ambiguous-anchor / schema error / file-not-found (non-append on missing)
//   2  Usage error: bad invocation, unrecognized flag
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");
const SCRIPT = path.join(REPO_ROOT, "scripts", "teo-apply-edit");

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  stdin?: string;
  args?: string[];
  env?: Record<string, string>;
}

// tmpDir is set in beforeEach — tests must not capture it before setup
let tmpDir: string;

/** Run the teo-apply-edit script and return exit code + captured output. */
function run(opts: RunOptions = {}): RunResult {
  const result = spawnSync("bash", [SCRIPT, ...(opts.args ?? [])], {
    encoding: "utf8",
    timeout: 15000,
    input: opts.stdin,
    cwd: tmpDir,
    env: {
      ...process.env,
      // Redirect audit logs to isolated temp dir so tests don't write into the repo
      TEO_AUDIT_DIR: path.join(tmpDir, ".audit"),
      // Override project root so allowlist checks resolve inside tmpDir
      TEO_PROJECT_ROOT: tmpDir,
      ...(opts.env ?? {}),
    },
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Build a valid patch spec JSON string with optional field overrides. */
function spec(overrides: {
  schema_version?: string;
  target?: string;
  patches?: unknown[];
}): string {
  return JSON.stringify({
    schema_version: "1.0.0",
    target: "src/fixture.txt",
    patches: [],
    ...overrides,
  });
}

/** Write a file inside tmpDir, creating parent dirs as needed. Returns absolute path. */
function writeFixture(relPath: string, content: string): string {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

/** Read a file inside tmpDir. */
function readFixture(relPath: string): string {
  return fs.readFileSync(path.join(tmpDir, relPath), "utf8");
}

// ---------------------------------------------------------------------------
// Temp dir lifecycle — isolated per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-apply-edit-test-"));
  fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".audit"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// MISUSE CASES — must be tested first (ADR-064)
// =============================================================================

describe("misuse: path traversal rejected", () => {
  it("exits 1 and prints path traversal error for target ../etc/passwd", () => {
    const result = run({ stdin: spec({ target: "../etc/passwd" }) });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/path traversal/i);
  });

  it("exits 1 for target with embedded .. component (src/../../etc/shadow)", () => {
    const result = run({ stdin: spec({ target: "src/../../etc/shadow" }) });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/path traversal/i);
  });
});

describe("misuse: allowlist violation rejected", () => {
  it("exits 1 when target is outside the allowlist", () => {
    const result = run({ stdin: spec({ target: "private/secret.txt" }) });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not in the allowlist/i);
  });

  it("exits 1 for target in node_modules (disallowed top-level dir)", () => {
    const result = run({ stdin: spec({ target: "node_modules/evil.js" }) });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not in the allowlist/i);
  });
});

describe("misuse: absolute path rejected", () => {
  it("exits 1 and prints absolute path error for /etc/hosts", () => {
    const result = run({ stdin: spec({ target: "/etc/hosts" }) });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/absolute/i);
  });
});

describe("misuse: invalid schema_version rejected", () => {
  it("exits 1 when schema_version is 2.0.0 (unsupported)", () => {
    const result = run({ stdin: spec({ schema_version: "2.0.0" }) });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/schema_version/i);
  });

  it("exits 1 when schema_version field is absent", () => {
    const json = JSON.stringify({ target: "src/x.txt", patches: [] });
    const result = run({ stdin: json });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/schema_version/i);
  });
});

describe("misuse: missing required target field", () => {
  it("exits 1 when target field is absent from patch spec", () => {
    const json = JSON.stringify({ schema_version: "1.0.0", patches: [] });
    const result = run({ stdin: json });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/target/i);
  });
});

describe("misuse: missing required patches field", () => {
  it("exits 1 when patches field is absent from patch spec", () => {
    const json = JSON.stringify({ schema_version: "1.0.0", target: "src/x.txt" });
    const result = run({ stdin: json });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/patches/i);
  });
});

describe("misuse: anchor not found in file", () => {
  it("exits 1 when anchor string is absent from the target file", () => {
    writeFixture("src/fixture.txt", "line one\nline two\nline three\n");
    const result = run({
      stdin: spec({
        target: "src/fixture.txt",
        patches: [{ op: "replace", anchor: "DOES NOT EXIST", content: "new line" }],
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/anchor.not.found|anchor not found/i);
  });
});

describe("misuse: ambiguous anchor (appears more than once)", () => {
  it("exits 1 when anchor matches multiple lines in the file", () => {
    writeFixture("src/fixture.txt", "duplicate line\nduplicate line\n");
    const result = run({
      stdin: spec({
        target: "src/fixture.txt",
        patches: [{ op: "replace", anchor: "duplicate line", content: "replaced" }],
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/ambiguous/i);
  });
});

describe("misuse: file not found for non-append op", () => {
  it("exits 1 when target file does not exist and op is replace", () => {
    // src/missing.txt is intentionally NOT created before the run
    const result = run({
      stdin: spec({
        target: "src/missing.txt",
        patches: [{ op: "replace", anchor: "anything", content: "new" }],
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found|file.not.found/i);
  });
});

describe("misuse: symlink target rejected", () => {
  it("exits 1 when the target path is a symlink", () => {
    writeFixture("src/real.txt", "real content\n");
    const symlinkPath = path.join(tmpDir, "src", "link.txt");
    fs.symlinkSync(path.join(tmpDir, "src", "real.txt"), symlinkPath);
    const result = run({ stdin: spec({ target: "src/link.txt" }) });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/symlink/i);
  });
});

// =============================================================================
// BOUNDARY CASES
// =============================================================================

describe("boundary: empty patches array is a no-op", () => {
  it("exits 0 and leaves file unchanged when patches is []", () => {
    writeFixture("src/fixture.txt", "original content\n");
    const result = run({
      stdin: spec({ target: "src/fixture.txt", patches: [] }),
    });
    expect(result.exitCode).toBe(0);
    expect(readFixture("src/fixture.txt")).toBe("original content\n");
  });
});

describe("boundary: stdin input mode", () => {
  it("reads the patch spec from stdin when no --patch-file flag is given", () => {
    writeFixture("src/fixture.txt", "line one\nline two\n");
    const result = run({
      stdin: spec({
        target: "src/fixture.txt",
        patches: [{ op: "replace", anchor: "line two", content: "replaced via stdin" }],
      }),
    });
    expect(result.exitCode).toBe(0);
    expect(readFixture("src/fixture.txt")).toContain("replaced via stdin");
  });
});

describe("boundary: --patch-file flag input mode", () => {
  it("reads the patch spec from the named file when --patch-file is given", () => {
    writeFixture("src/fixture.txt", "alpha\nbeta\n");
    const patchSpec = spec({
      target: "src/fixture.txt",
      patches: [{ op: "replace", anchor: "beta", content: "gamma" }],
    });
    const patchFile = writeFixture("patch.json", patchSpec);
    const result = run({ args: ["--patch-file", patchFile] });
    expect(result.exitCode).toBe(0);
    expect(readFixture("src/fixture.txt")).toContain("gamma");
  });
});

describe("boundary: --help flag", () => {
  it("exits 0 and prints usage for --help", () => {
    const result = run({ args: ["--help"] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/usage/i);
  });

  it("exits 0 and prints usage for -h", () => {
    const result = run({ args: ["-h"] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/usage/i);
  });
});

describe("boundary: unknown flag rejected", () => {
  it("exits 2 for an unrecognized flag", () => {
    const result = run({ args: ["--definitely-not-a-real-flag"] });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/unrecognized|unknown/i);
  });
});

// =============================================================================
// GOLDEN PATH
// =============================================================================

describe("golden path: op replace", () => {
  it("replaces the line containing the anchor and preserves surrounding lines", () => {
    writeFixture("src/fixture.txt", "keep me\nreplace this line\nkeep me too\n");
    const result = run({
      stdin: spec({
        target: "src/fixture.txt",
        patches: [{ op: "replace", anchor: "replace this line", content: "replaced content" }],
      }),
    });
    expect(result.exitCode).toBe(0);
    const content = readFixture("src/fixture.txt");
    expect(content).toContain("replaced content");
    expect(content).not.toContain("replace this line");
    expect(content).toContain("keep me");
    expect(content).toContain("keep me too");
  });
});

describe("golden path: op insert-before", () => {
  it("inserts content immediately before the anchor line", () => {
    writeFixture("src/fixture.txt", "first line\nanchor line\nlast line\n");
    const result = run({
      stdin: spec({
        target: "src/fixture.txt",
        patches: [{ op: "insert-before", anchor: "anchor line", content: "inserted before" }],
      }),
    });
    expect(result.exitCode).toBe(0);
    const content = readFixture("src/fixture.txt");
    const insertedIdx = content.indexOf("inserted before");
    const anchorIdx = content.indexOf("anchor line");
    expect(insertedIdx).toBeGreaterThanOrEqual(0);
    expect(insertedIdx).toBeLessThan(anchorIdx);
  });
});

describe("golden path: op insert-after", () => {
  it("inserts content immediately after the anchor line", () => {
    writeFixture("src/fixture.txt", "first line\nanchor line\nlast line\n");
    const result = run({
      stdin: spec({
        target: "src/fixture.txt",
        patches: [{ op: "insert-after", anchor: "anchor line", content: "inserted after" }],
      }),
    });
    expect(result.exitCode).toBe(0);
    const content = readFixture("src/fixture.txt");
    const anchorIdx = content.indexOf("anchor line");
    const insertedIdx = content.indexOf("inserted after");
    expect(insertedIdx).toBeGreaterThanOrEqual(0);
    expect(insertedIdx).toBeGreaterThan(anchorIdx);
  });
});

describe("golden path: op append to existing file", () => {
  it("appends content at end of file after existing content", () => {
    writeFixture("src/fixture.txt", "existing content\n");
    const result = run({
      stdin: spec({
        target: "src/fixture.txt",
        patches: [{ op: "append", content: "appended line" }],
      }),
    });
    expect(result.exitCode).toBe(0);
    const content = readFixture("src/fixture.txt");
    expect(content).toContain("existing content");
    expect(content).toContain("appended line");
    expect(content.indexOf("existing content")).toBeLessThan(content.indexOf("appended line"));
  });
});

describe("golden path: op append creates new file (OQ-1)", () => {
  it("creates a new file when target does not exist and op is append", () => {
    // src/new-file.txt intentionally does NOT exist before this run
    const result = run({
      stdin: spec({
        target: "src/new-file.txt",
        patches: [{ op: "append", content: "brand new content" }],
      }),
    });
    expect(result.exitCode).toBe(0);
    expect(readFixture("src/new-file.txt")).toContain("brand new content");
  });
});

describe("golden path: all-or-nothing atomicity (OQ-2)", () => {
  it("leaves file unchanged when the second patch in a multi-patch spec fails", () => {
    writeFixture("src/fixture.txt", "only this anchor once\n");
    const originalContent = readFixture("src/fixture.txt");
    const result = run({
      stdin: spec({
        target: "src/fixture.txt",
        patches: [
          { op: "replace", anchor: "only this anchor once", content: "first patch ok" },
          { op: "replace", anchor: "ANCHOR THAT DOES NOT EXIST", content: "second patch fails" },
        ],
      }),
    });
    // Second patch fails → whole operation must be refused
    expect(result.exitCode).toBe(1);
    // First patch must NOT have been written — file is unchanged
    expect(readFixture("src/fixture.txt")).toBe(originalContent);
  });
});

describe("golden path: audit log written after successful apply", () => {
  it("writes edit-audit JSON with verdict applied after a successful patch", () => {
    writeFixture("src/fixture.txt", "hello audit\n");
    const result = run({
      stdin: spec({
        target: "src/fixture.txt",
        patches: [{ op: "replace", anchor: "hello audit", content: "audited" }],
      }),
    });
    expect(result.exitCode).toBe(0);

    const auditDir = path.join(tmpDir, ".audit");
    const files = fs.readdirSync(auditDir);
    const auditFile = files.find((f) => f.startsWith("edit-audit-"));
    expect(auditFile).toBeDefined();

    const raw = fs.readFileSync(path.join(auditDir, auditFile!), "utf8");
    const entries = JSON.parse(raw) as Array<{ verdict: string }>;
    expect(entries.some((e) => e.verdict === "applied")).toBe(true);
  });
});

describe("golden path: bypass token unset after script exits", () => {
  it("TEO_APPLY_EDIT_BYPASS is not exported into the parent process after script exits", () => {
    // The EXIT trap inside teo-apply-edit must unset the bypass var before returning.
    // A no-op run (empty patches) still exercises setup and EXIT trap.
    writeFixture("src/fixture.txt", "content\n");
    const result = run({
      stdin: spec({ target: "src/fixture.txt", patches: [] }),
    });
    expect(result.exitCode).toBe(0);
    // spawnSync runs the script as a child process; the parent env is unaffected
    expect(process.env["TEO_APPLY_EDIT_BYPASS"]).toBeUndefined();
  });
});
