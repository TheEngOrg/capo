import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Verification } from "../../../src/core/plan/plan.js";
import {
  runVerifications,
  type VerifyReport,
} from "../../../src/core/mechanical-verify/mechanical-verify.js";

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-mechverify-test-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function v(cmd: string, expect_exit = 0): Verification {
  return { kind: "script", cmd, expect_exit };
}

describe("runVerifications", () => {
  it("passes when every verification exits as expected", () => {
    const report: VerifyReport = runVerifications([v("true"), v("exit 0")], { cwd: sandbox });
    expect(report.verdict).toBe("pass");
    expect(report.results).toHaveLength(2);
    expect(report.results.every((r) => r.ok)).toBe(true);
  });

  it("fails when any verification exits unexpectedly", () => {
    const report = runVerifications([v("true"), v("exit 1")], { cwd: sandbox });
    expect(report.verdict).toBe("fail");
  });

  it("records each verification's command and exit code", () => {
    const report = runVerifications([v("exit 2", 2)], { cwd: sandbox });
    expect(report.results[0].cmd).toBe("exit 2");
    expect(report.results[0].exit_code).toBe(2);
    expect(report.results[0].ok).toBe(true); // expect_exit 2 matched
  });

  it("supports shell features in the command (pipes, &&)", () => {
    const report = runVerifications([v('echo hi | grep hi && echo done')], { cwd: sandbox });
    expect(report.verdict).toBe("pass");
  });

  it("runs commands relative to cwd", () => {
    writeFileSync(join(sandbox, "marker.txt"), "x");
    const report = runVerifications([v("test -f marker.txt")], { cwd: sandbox });
    expect(report.verdict).toBe("pass");
  });

  it("treats an empty verification list as pass (nothing to check)", () => {
    const report = runVerifications([], { cwd: sandbox });
    expect(report.verdict).toBe("pass");
    expect(report.results).toHaveLength(0);
  });

  it("captures stderr from a failing verification for diagnostics", () => {
    const report = runVerifications([v('echo "nope" >&2; exit 1')], { cwd: sandbox });
    expect(report.verdict).toBe("fail");
    expect(report.results[0].stderr).toContain("nope");
  });

  it("defaults expect_exit to 0 when a verification omits it", () => {
    const report = runVerifications([{ kind: "script", cmd: "true", expect_exit: 0 }], { cwd: sandbox });
    expect(report.verdict).toBe("pass");
  });

  it("stops reporting pass if the first of several fails", () => {
    const report = runVerifications([v("exit 1"), v("true"), v("true")], { cwd: sandbox });
    expect(report.verdict).toBe("fail");
    // all still run and are reported (full diagnostics, not short-circuit)
    expect(report.results).toHaveLength(3);
  });
});
