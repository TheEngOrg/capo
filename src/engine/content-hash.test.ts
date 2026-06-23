// WS-SEC-01 — passing (post-impl, CAD gate 2)
// WS-CRYPTO-03 — passing (post-impl, CAD gate 2): per-file size cap
//
// Tests for src/engine/content-hash.ts — the computeContentHash() utility.
//
// computeContentHash(dirPath: string, opts?: { fileSizeLimitBytes?: number }):
//   Promise<ContentHashResult | null>
//
//   ContentHashResult { hash: string; skipped_count: number }
//
//   - Returns SHA-256 of the full recursive directory tree.
//   - Files over fileSizeLimitBytes are SKIPPED (not read into memory).
//   - Skipped files are warned via console.warn. skipped_count reflects how many
//     were skipped. The hash covers only the non-oversized files.
//   - Fail-open: non-existent path, file (not dir), or error → returns null.
//   - Deterministic: sorted file paths guarantee same hash for same content
//     regardless of filesystem traversal order.
//   - hash field is a 64-hex-char string on success.
//
// Ordering: misuse → boundary → golden path (ADR-064 policy)
//
// WS-SEC-01 implementation complete. All prior specs pass.
// WS-CRYPTO-03 implementation complete. All 9 size-cap specs pass.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { computeContentHash } from "./content-hash.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "teo-content-hash-"));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// MISUSE: paths that should return null, never throw
// ---------------------------------------------------------------------------

describe("computeContentHash() — misuse: non-existent or invalid paths", () => {
  it("non-existent dirPath → returns null (fail-open, never throws)", async () => {
    const fakePath = "/non/existent/directory/that/does/not/exist";

    const result = await computeContentHash(fakePath);

    expect(result).toBeNull();
  });

  it("dirPath is a file, not a directory → returns null", async () => {
    const tmpDir = makeTempDir();
    try {
      const filePath = path.join(tmpDir, "not-a-dir.txt");
      fs.writeFileSync(filePath, "I am a file, not a directory");

      const result = await computeContentHash(filePath);

      expect(result).toBeNull();
    } finally {
      removeTempDir(tmpDir);
    }
  });

  it("non-existent path does not throw — returns null synchronously-resolved promise", async () => {
    const fakePath = "/absolutely/does/not/exist/9f8e7d6c";

    // Must not throw — the promise must resolve to null
    await expect(computeContentHash(fakePath)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: edge-case directories
// ---------------------------------------------------------------------------

describe("computeContentHash() — boundary: edge-case directories", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("empty directory → returns a stable 64-hex-char hash (deterministic)", async () => {
    // An empty directory has a defined, reproducible hash (hash of empty content)
    const result = await computeContentHash(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("empty directory → same hash on repeated calls (deterministic)", async () => {
    const result1 = await computeContentHash(tmpDir);
    const result2 = await computeContentHash(tmpDir);

    expect(result1!.hash).toBe(result2!.hash);
  });

  it("directory with one file → returns 64-hex-char string", async () => {
    fs.writeFileSync(path.join(tmpDir, "single.txt"), "hello world");

    const result = await computeContentHash(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("directory with one file: different content → different hash", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "content version 1");
    const hash1 = await computeContentHash(tmpDir);

    fs.writeFileSync(path.join(tmpDir, "file.txt"), "content version 2");
    const hash2 = await computeContentHash(tmpDir);

    expect(hash1!.hash).not.toBe(hash2!.hash);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: multi-file directories
// ---------------------------------------------------------------------------

describe("computeContentHash() — golden path: multi-file directories", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("directory with multiple files → deterministic 64-hex-char hash", async () => {
    fs.writeFileSync(path.join(tmpDir, "alpha.ts"), "export const a = 1;");
    fs.writeFileSync(path.join(tmpDir, "beta.ts"), "export const b = 2;");
    fs.writeFileSync(path.join(tmpDir, "gamma.ts"), "export const c = 3;");

    const result = await computeContentHash(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same files, called twice → identical hash (pure determinism)", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "const x = 1;");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "const y = 2;");

    const hash1 = await computeContentHash(tmpDir);
    const hash2 = await computeContentHash(tmpDir);

    expect(hash1!.hash).toBe(hash2!.hash);
  });

  it("file content change in multi-file dir → different hash", async () => {
    const fileA = path.join(tmpDir, "a.ts");
    const fileB = path.join(tmpDir, "b.ts");
    fs.writeFileSync(fileA, "const x = 1;");
    fs.writeFileSync(fileB, "const y = 2;");

    const hashBefore = await computeContentHash(tmpDir);

    // Mutate one file
    fs.writeFileSync(fileA, "const x = 999; // changed");

    const hashAfter = await computeContentHash(tmpDir);

    expect(hashBefore!.hash).not.toBe(hashAfter!.hash);
  });

  it("file addition → different hash (new file changes the tree)", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "const x = 1;");
    const hashBefore = await computeContentHash(tmpDir);

    // Add a second file
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "const y = 2;");
    const hashAfter = await computeContentHash(tmpDir);

    expect(hashBefore!.hash).not.toBe(hashAfter!.hash);
  });

  it("file removal → different hash (fewer files changes the tree)", async () => {
    const fileA = path.join(tmpDir, "a.ts");
    const fileB = path.join(tmpDir, "b.ts");
    fs.writeFileSync(fileA, "const x = 1;");
    fs.writeFileSync(fileB, "const y = 2;");

    const hashBefore = await computeContentHash(tmpDir);

    fs.rmSync(fileB);

    const hashAfter = await computeContentHash(tmpDir);

    expect(hashBefore!.hash).not.toBe(hashAfter!.hash);
  });

  it("files are sorted before hashing — two dirs with identical files in any order produce the same hash", async () => {
    // Create two separate temp dirs with the same files but ensure the hash
    // is path-independent by writing files in different "stat order".
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "teo-hash-order-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "teo-hash-order-b-"));

    try {
      // Write files in one order to dirA
      fs.writeFileSync(path.join(dirA, "alpha.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(dirA, "beta.ts"), "export const b = 2;");
      fs.writeFileSync(path.join(dirA, "gamma.ts"), "export const c = 3;");

      // Write files in a different order to dirB (same content, same relative paths)
      fs.writeFileSync(path.join(dirB, "gamma.ts"), "export const c = 3;");
      fs.writeFileSync(path.join(dirB, "alpha.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(dirB, "beta.ts"), "export const b = 2;");

      const hashA = await computeContentHash(dirA);
      const hashB = await computeContentHash(dirB);

      // Content + relative paths are identical → hashes must match
      expect(hashA!.hash).toBe(hashB!.hash);
    } finally {
      removeTempDir(dirA);
      removeTempDir(dirB);
    }
  });

  it("recursive directory tree → includes files in subdirectories", async () => {
    // Without recursion, subdirectory contents would be missed
    const subDir = path.join(tmpDir, "subdir");
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(tmpDir, "root.ts"), "const r = 0;");
    fs.writeFileSync(path.join(subDir, "nested.ts"), "const n = 1;");

    const hashWithSubdir = await computeContentHash(tmpDir);

    // Now remove the nested file — hash must change if recursion works
    fs.rmSync(path.join(subDir, "nested.ts"));

    const hashWithoutNested = await computeContentHash(tmpDir);

    expect(hashWithSubdir!.hash).not.toBe(hashWithoutNested!.hash);
  });
});

// ---------------------------------------------------------------------------
// WS-CRYPTO-01: exclusion of large/binary dirs (.git/, node_modules/, etc.)
// ---------------------------------------------------------------------------

describe("computeContentHash() — WS-CRYPTO-01: exclusion of large/binary dirs", () => {
  it("EXCL-1: .git/ subdirectory is excluded — hash is identical whether .git/ is present or not", async () => {
    // Two temp dirs with identical tracked content but one also has a .git/ dir.
    // .git/ is excluded from traversal so hashes must match.
    const dirWithoutGit = fs.mkdtempSync(path.join(os.tmpdir(), "teo-hash-nogit-"));
    const dirWithGit = fs.mkdtempSync(path.join(os.tmpdir(), "teo-hash-git-"));

    try {
      // Write identical tracked files to both dirs
      fs.writeFileSync(path.join(dirWithoutGit, "index.ts"), "export const x = 1;");
      fs.writeFileSync(path.join(dirWithGit, "index.ts"), "export const x = 1;");

      // Add a .git/ dir with some internal files to dirWithGit only
      const gitDir = path.join(dirWithGit, ".git");
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
      fs.writeFileSync(path.join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n");

      const hashWithout = await computeContentHash(dirWithoutGit);
      const hashWith = await computeContentHash(dirWithGit);

      // .git/ is excluded → same tracked content → identical hashes
      expect(hashWithout).not.toBeNull();
      expect(hashWith).not.toBeNull();
      expect(hashWith!.hash).toBe(hashWithout!.hash);
    } finally {
      fs.rmSync(dirWithoutGit, { recursive: true, force: true });
      fs.rmSync(dirWithGit, { recursive: true, force: true });
    }
  });

  it("EXCL-2: node_modules/ subdirectory is excluded — hash is identical whether node_modules/ is present or not", async () => {
    // Same approach as EXCL-1 but for node_modules/.
    const dirWithout = fs.mkdtempSync(path.join(os.tmpdir(), "teo-hash-nomod-"));
    const dirWith = fs.mkdtempSync(path.join(os.tmpdir(), "teo-hash-mod-"));

    try {
      // Identical tracked files in both
      fs.writeFileSync(path.join(dirWithout, "src.ts"), "const a = 42;");
      fs.writeFileSync(path.join(dirWith, "src.ts"), "const a = 42;");

      // Add node_modules/ with a package to dirWith only
      const nodeModDir = path.join(dirWith, "node_modules");
      const pkgDir = path.join(nodeModDir, "some-package");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = {};");
      fs.writeFileSync(
        path.join(pkgDir, "package.json"),
        '{"name":"some-package","version":"1.0.0"}'
      );

      const hashWithout = await computeContentHash(dirWithout);
      const hashWith = await computeContentHash(dirWith);

      // node_modules/ is excluded → same tracked content → identical hashes
      expect(hashWithout).not.toBeNull();
      expect(hashWith).not.toBeNull();
      expect(hashWith!.hash).toBe(hashWithout!.hash);
    } finally {
      fs.rmSync(dirWithout, { recursive: true, force: true });
      fs.rmSync(dirWith, { recursive: true, force: true });
    }
  });

  it("EXCL-3: hashing a dir with node_modules/ containing many files does NOT error or timeout", async () => {
    // Performance guard: even with N files in node_modules/, computeContentHash()
    // must complete without error because it skips the directory entirely.
    // Using 50 files (representative; real node_modules can be 100k+ files).
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-hash-perf-"));

    try {
      // One tracked source file
      fs.writeFileSync(path.join(tmpDir, "main.ts"), "export default 42;");

      // node_modules/ with 50 files spread across nested dirs
      const nmDir = path.join(tmpDir, "node_modules");
      fs.mkdirSync(nmDir);
      for (let i = 0; i < 50; i++) {
        const pkgDir = path.join(nmDir, `pkg-${i}`);
        fs.mkdirSync(pkgDir);
        fs.writeFileSync(path.join(pkgDir, "index.js"), `// package ${i}`);
      }

      // Must not throw, must not time out (vitest default timeout is 5s)
      const result = await computeContentHash(tmpDir);

      // Returns a valid hash (not null) — the tracked main.ts file is included
      expect(result).not.toBeNull();
      expect(result!.hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("EXCL-4: dir without .git/ or node_modules/ still hashes correctly — backward compatibility", async () => {
    // Regression guard: the exclusion logic must not break hashing of normal dirs.
    // A dir with only regular files must still return a valid 64-hex-char hash.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-hash-compat-"));

    try {
      fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(tmpDir, "b.ts"), "export const b = 2;");
      const subDir = path.join(tmpDir, "lib");
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, "util.ts"), "export const util = true;");

      const result = await computeContentHash(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// WS-CRYPTO-03: per-file size cap (post-impl, passing)
//
// Implemented in content-hash.ts:
//   - Return type: Promise<ContentHashResult | null>
//     where ContentHashResult = { hash: string; skipped_count: number }
//   - Function signature:
//     computeContentHash(dirPath: string, opts?: { fileSizeLimitBytes?: number })
//   - Files over opts.fileSizeLimitBytes are skipped (not read), a warning is
//     logged via console.warn, and skipped_count is incremented.
//   - Default threshold (when opts omitted): FILE_SIZE_LIMIT_BYTES (50 MB).
//   - Hash is still computed over the remaining non-oversized files.
//   - If ALL files are oversized: hash of empty set (identical to empty-dir hash).
//
// Strategy: tests pass a small fileSizeLimitBytes (e.g. 10 bytes) so tiny
// real files on disk trigger the "oversized" branch without allocating 50 MB.
// ---------------------------------------------------------------------------

describe("computeContentHash() — WS-CRYPTO-03: per-file size cap", () => {
  let tmpDir: string;
  let warnSpy: { mock: { calls: string[][] }; mockRestore: () => void };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-crypto03-"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}) as unknown as typeof warnSpy;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  // CRYPTO03-1: one oversized file → skipped_count === 1, result is not null
  it("CRYPTO03-1: one oversized file → returns { hash, skipped_count: 1 }, never null", async () => {
    // "large.bin" is 20 bytes; threshold is 10 bytes → over threshold → skipped
    fs.writeFileSync(path.join(tmpDir, "large.bin"), Buffer.alloc(20));

    const result = await computeContentHash(tmpDir, { fileSizeLimitBytes: 10 });

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("hash");
    expect(result).toHaveProperty("skipped_count", 1);
  });

  // CRYPTO03-2: oversized file is excluded from hash — hash equals empty-dir hash
  it("CRYPTO03-2: oversized file is skipped — hash equals hash of dir without that file", async () => {
    // Compute baseline: empty dir (no files at all)
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-crypto03-empty-"));
    let emptyDirResult: { hash: string; skipped_count: number } | null = null;
    try {
      emptyDirResult = (await computeContentHash(emptyDir, {
        fileSizeLimitBytes: 10,
      })) as typeof emptyDirResult;
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }

    // Now add an oversized file to tmpDir
    fs.writeFileSync(path.join(tmpDir, "oversized.bin"), Buffer.alloc(20));
    const result = (await computeContentHash(tmpDir, { fileSizeLimitBytes: 10 })) as {
      hash: string;
      skipped_count: number;
    } | null;

    expect(result).not.toBeNull();
    expect(emptyDirResult).not.toBeNull();
    // result must be an object with a hash field (not a bare string) — fails pre-impl
    expect(typeof result).toBe("object");
    expect(typeof result!.hash).toBe("string");
    // skipped_count must be 1 — the oversized file was skipped — fails pre-impl
    expect(result!.skipped_count).toBe(1);
    // Hash of dir-with-only-oversized-file must equal empty-dir hash (oversized file excluded)
    expect(result!.hash).toBe(emptyDirResult!.hash);
  });

  // CRYPTO03-3: no oversized files → skipped_count === 0 (backward-compatible)
  it("CRYPTO03-3: no oversized files → skipped_count === 0 (backward-compatible behavior)", async () => {
    fs.writeFileSync(path.join(tmpDir, "small.txt"), "hi"); // 2 bytes, under 10-byte threshold

    const result = await computeContentHash(tmpDir, { fileSizeLimitBytes: 10 });

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("skipped_count", 0);
    expect(result).toHaveProperty("hash");
  });

  // CRYPTO03-4: mix of normal + oversized files → skipped_count matches oversized count,
  //             hash covers only the non-oversized files
  it("CRYPTO03-4: mix of normal + oversized → skipped_count equals oversized count; hash covers only normal files", async () => {
    // normal.txt: 5 bytes (under 10 threshold)
    // big1.bin, big2.bin: 20 bytes each (over 10 threshold)
    fs.writeFileSync(path.join(tmpDir, "normal.txt"), "hello"); // 5 bytes
    fs.writeFileSync(path.join(tmpDir, "big1.bin"), Buffer.alloc(20));
    fs.writeFileSync(path.join(tmpDir, "big2.bin"), Buffer.alloc(20));

    const result = (await computeContentHash(tmpDir, { fileSizeLimitBytes: 10 })) as {
      hash: string;
      skipped_count: number;
    } | null;

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("skipped_count", 2);

    // The hash must equal the hash of a dir with only "normal.txt"
    const refDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-crypto03-ref-"));
    try {
      fs.writeFileSync(path.join(refDir, "normal.txt"), "hello");
      const refResult = (await computeContentHash(refDir, { fileSizeLimitBytes: 10 })) as {
        hash: string;
        skipped_count: number;
      } | null;
      expect(refResult).not.toBeNull();
      expect(result!.hash).toBe(refResult!.hash);
    } finally {
      fs.rmSync(refDir, { recursive: true, force: true });
    }
  });

  // CRYPTO03-5: all files oversized → hash equals empty-dir hash, skipped_count > 0
  it("CRYPTO03-5: all files oversized → hash equals empty-dir hash; skipped_count > 0", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.bin"), Buffer.alloc(20));
    fs.writeFileSync(path.join(tmpDir, "b.bin"), Buffer.alloc(20));
    fs.writeFileSync(path.join(tmpDir, "c.bin"), Buffer.alloc(20));

    const allOversizedResult = (await computeContentHash(tmpDir, { fileSizeLimitBytes: 10 })) as {
      hash: string;
      skipped_count: number;
    } | null;

    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-crypto03-allempty-"));
    let emptyResult: { hash: string; skipped_count: number } | null = null;
    try {
      emptyResult = (await computeContentHash(emptyDir, {
        fileSizeLimitBytes: 10,
      })) as typeof emptyResult;
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }

    expect(allOversizedResult).not.toBeNull();
    expect(emptyResult).not.toBeNull();
    expect(allOversizedResult!.skipped_count).toBe(3);
    expect(allOversizedResult!.hash).toBe(emptyResult!.hash);
  });

  // CRYPTO03-6: warning is logged for each skipped file
  it("CRYPTO03-6: console.warn is called for each skipped file, containing the file path", async () => {
    const largePath = path.join(tmpDir, "large.bin");
    fs.writeFileSync(largePath, Buffer.alloc(20));

    await computeContentHash(tmpDir, { fileSizeLimitBytes: 10 });

    // At least one console.warn call must reference the oversized file path
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("large.bin");
  });

  // CRYPTO03-7: hash field preserves 64-hex-char format
  it("CRYPTO03-7: hash field is a 64-hex-char SHA-256 string regardless of skipped files", async () => {
    fs.writeFileSync(path.join(tmpDir, "small.txt"), "data"); // 4 bytes, under threshold
    fs.writeFileSync(path.join(tmpDir, "big.bin"), Buffer.alloc(20)); // over threshold

    const result = await computeContentHash(tmpDir, { fileSizeLimitBytes: 10 });

    expect(result).not.toBeNull();
    expect(result!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // CRYPTO03-8: result shape — return value is an object, not a bare string
  it("CRYPTO03-8: return value is an object { hash, skipped_count }, NOT a bare string", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "ok");

    const result = await computeContentHash(tmpDir, { fileSizeLimitBytes: 10 });

    expect(result).not.toBeNull();
    // Must be an object, not a primitive string
    expect(typeof result).toBe("object");
    expect(typeof result!.hash).toBe("string");
    expect(typeof result!.skipped_count).toBe("number");
  });

  // CRYPTO03-9: default threshold (no opts) — large real file is skipped
  //             Uses a sparse write to create a 60 MB apparent file without
  //             allocating 60 MB of memory.
  it("CRYPTO03-9: default threshold (no opts) — a 60 MB sparse file is skipped", async () => {
    const bigPath = path.join(tmpDir, "huge.bin");
    // Create a sparse file: open, seek to 60 MB - 1, write 1 byte, close.
    // On most filesystems this creates a 60 MB apparent file with minimal allocation.
    const fd = fs.openSync(bigPath, "w");
    fs.writeSync(fd, Buffer.alloc(1), 0, 1, 60 * 1024 * 1024 - 1);
    fs.closeSync(fd);

    const result = await computeContentHash(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.skipped_count).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});
