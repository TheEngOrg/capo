import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScript, type ScriptResult } from "../../../src/core/script-runner/script-runner.js";

let sandbox: string;

/** Write an executable shell script into the sandbox and return its path. */
function writeScript(name: string, body: string): string {
  const path = join(sandbox, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-script-runner-test-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("runScript", () => {
  it("runs a script and captures exit 0 + stdout", () => {
    const path = writeScript("ok.sh", 'echo "hello from script"');
    const res: ScriptResult = runScript({ path, expect_exit: 0 }, { cwd: sandbox });
    expect(res.exit_code).toBe(0);
    expect(res.stdout).toContain("hello from script");
    expect(res.ok).toBe(true);
  });

  it("captures a non-zero exit and marks ok=false against expect_exit 0", () => {
    const path = writeScript("fail.sh", "exit 3");
    const res = runScript({ path, expect_exit: 0 }, { cwd: sandbox });
    expect(res.exit_code).toBe(3);
    expect(res.ok).toBe(false);
  });

  it("treats a matching non-zero expect_exit as ok", () => {
    const path = writeScript("expected-fail.sh", "exit 7");
    const res = runScript({ path, expect_exit: 7 }, { cwd: sandbox });
    expect(res.exit_code).toBe(7);
    expect(res.ok).toBe(true);
  });

  it("captures stderr", () => {
    const path = writeScript("err.sh", 'echo "boom" >&2');
    const res = runScript({ path, expect_exit: 0 }, { cwd: sandbox });
    expect(res.stderr).toContain("boom");
  });

  it("passes args through to the script", () => {
    const path = writeScript("args.sh", 'echo "got:$1:$2"');
    const res = runScript({ path, args: ["a", "b"], expect_exit: 0 }, { cwd: sandbox });
    expect(res.stdout).toContain("got:a:b");
  });

  it("defaults expect_exit to 0 when omitted", () => {
    const path = writeScript("plain.sh", "true");
    const res = runScript({ path }, { cwd: sandbox });
    expect(res.ok).toBe(true);
  });

  it("reports a duration_ms >= 0", () => {
    const path = writeScript("quick.sh", "true");
    const res = runScript({ path, expect_exit: 0 }, { cwd: sandbox });
    expect(res.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns ok=false (not throw) when the executable does not exist", () => {
    const res = runScript({ path: join(sandbox, "nonexistent.sh"), expect_exit: 0 }, { cwd: sandbox });
    expect(res.ok).toBe(false);
    expect(res.exit_code).not.toBe(0);
  });

  it("merges extra env into the script environment", () => {
    const path = writeScript("env.sh", 'echo "env:$TEO_TEST_VAR"');
    const res = runScript({ path, expect_exit: 0 }, { cwd: sandbox, env: { TEO_TEST_VAR: "xyz" } });
    expect(res.stdout).toContain("env:xyz");
  });

  it("returns ok=false and surfaces the error message when a script times out", () => {
    const path = writeScript("slow.sh", "sleep 5");
    const res = runScript({ path, expect_exit: 0 }, { cwd: sandbox, timeout_ms: 50 });
    expect(res.ok).toBe(false);
    expect(res.exit_code).toBe(127);
    expect(res.stderr.length).toBeGreaterThan(0);
  });

  it("maps a signal-killed script (null exit status) to exit_code 1", () => {
    // Killing itself with SIGKILL yields status:null, signal set, no spawn error.
    const path = writeScript("selfkill.sh", 'kill -9 "$$"');
    const res = runScript({ path, expect_exit: 0 }, { cwd: sandbox });
    expect(res.exit_code).toBe(1);
    expect(res.ok).toBe(false);
  });

  it("runs in the given cwd", () => {
    const path = writeScript("pwd.sh", "pwd");
    const res = runScript({ path, expect_exit: 0 }, { cwd: sandbox });
    // macOS /tmp symlinks to /private/tmp; assert the basename matches.
    expect(res.stdout).toContain(sandbox.split("/").pop() as string);
  });
});
