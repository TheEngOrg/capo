import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveTeoHome,
  ensureTeoHome,
  projectId,
  projectPaths,
  type TeoHome,
} from "../../../src/core/home/home.js";

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-home-test-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("resolveTeoHome", () => {
  it("uses TEO_HOME when set", () => {
    const home = resolveTeoHome({ TEO_HOME: join(sandbox, "custom") });
    expect(home.root).toBe(join(sandbox, "custom"));
  });

  it("falls back to <HOME>/.teo when TEO_HOME is unset", () => {
    const home = resolveTeoHome({ HOME: sandbox });
    expect(home.root).toBe(join(sandbox, ".teo"));
  });

  it("exposes keyring, registry, and memory paths under root", () => {
    const home = resolveTeoHome({ TEO_HOME: sandbox });
    expect(home.keyringDir).toBe(join(sandbox, "keyring"));
    expect(home.signingKeyPath).toBe(join(sandbox, "keyring", "signing.key"));
    expect(home.registryPath).toBe(join(sandbox, "registry", "agents.jsonl"));
    expect(home.memoryDir).toBe(join(sandbox, "memory"));
    expect(home.worktreesDir).toBe(join(sandbox, "worktrees"));
  });

  it("throws when neither TEO_HOME nor HOME is available", () => {
    expect(() => resolveTeoHome({})).toThrow(/HOME/);
  });
});

describe("ensureTeoHome", () => {
  let home: TeoHome;

  beforeEach(() => {
    home = resolveTeoHome({ TEO_HOME: sandbox });
  });

  it("creates the root, keyring, and registry directories", () => {
    ensureTeoHome(home);
    expect(existsSync(home.root)).toBe(true);
    expect(existsSync(home.keyringDir)).toBe(true);
    expect(existsSync(join(sandbox, "registry"))).toBe(true);
    expect(existsSync(home.memoryDir)).toBe(true);
  });

  it("creates the keyring directory with 0700 permissions", () => {
    ensureTeoHome(home);
    const mode = statSync(home.keyringDir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("is idempotent — second call does not throw", () => {
    ensureTeoHome(home);
    expect(() => ensureTeoHome(home)).not.toThrow();
  });

  it("does not create signing.key (that is the signing module's job)", () => {
    ensureTeoHome(home);
    expect(existsSync(home.signingKeyPath)).toBe(false);
  });
});

describe("projectId", () => {
  it("is stable for the same git remote across calls", () => {
    const a = projectId({ gitRemote: "git@github.com:wonton/eng-org.git" });
    const b = projectId({ gitRemote: "git@github.com:wonton/eng-org.git" });
    expect(a).toBe(b);
  });

  it("differs for different remotes", () => {
    const a = projectId({ gitRemote: "git@github.com:wonton/a.git" });
    const b = projectId({ gitRemote: "git@github.com:wonton/b.git" });
    expect(a).not.toBe(b);
  });

  it("falls back to abspath when no git remote", () => {
    const a = projectId({ absPath: "/Users/x/work/proj" });
    const b = projectId({ absPath: "/Users/x/work/proj" });
    expect(a).toBe(b);
    expect(a).not.toHaveLength(0);
  });

  it("prefers git remote over abspath when both present", () => {
    const withRemote = projectId({ gitRemote: "git@github.com:wonton/a.git", absPath: "/p1" });
    const remoteOnly = projectId({ gitRemote: "git@github.com:wonton/a.git" });
    expect(withRemote).toBe(remoteOnly);
  });

  it("returns a short hex prefix, not the raw path (no leak)", () => {
    const id = projectId({ absPath: "/Users/secret/path" });
    expect(id).not.toContain("secret");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("throws when given neither remote nor abspath", () => {
    expect(() => projectId({})).toThrow();
  });
});

describe("projectPaths", () => {
  it("namespaces plans/events/signoffs/streams under memory/<project-id>", () => {
    const home = resolveTeoHome({ TEO_HOME: sandbox });
    const pid = projectId({ absPath: "/Users/x/work/proj" });
    const paths = projectPaths(home, pid);
    expect(paths.plansDir).toBe(join(sandbox, "memory", pid, "plans"));
    expect(paths.eventsDir).toBe(join(sandbox, "memory", pid, "events"));
    expect(paths.signoffsDir).toBe(join(sandbox, "memory", pid, "signoffs"));
    expect(paths.streamsDir).toBe(join(sandbox, "memory", pid, "streams"));
  });

  it("ensureProjectPaths creates all four subdirs", () => {
    const home = resolveTeoHome({ TEO_HOME: sandbox });
    ensureTeoHome(home);
    const pid = projectId({ absPath: "/Users/x/work/proj" });
    const paths = projectPaths(home, pid);
    paths.ensure();
    expect(existsSync(paths.plansDir)).toBe(true);
    expect(existsSync(paths.eventsDir)).toBe(true);
    expect(existsSync(paths.signoffsDir)).toBe(true);
    expect(existsSync(paths.streamsDir)).toBe(true);
  });
});
