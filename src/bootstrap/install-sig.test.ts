// =============================================================================
// install-sig.test.ts — specs for src/bootstrap/install-sig.ts (WS-REVOKE-01)
//
// STATUS: PASSING — implementation in src/bootstrap/install-sig.ts
//
// ORDERING: misuse → boundary → golden path (adversarial-first policy)
//
// CONTRACT (what these tests enforce):
//
//   signPluginRoot(pluginRootPath, keyId, signerKey): Promise<void>
//     - Writes INSTALL_SIG_FILENAME into pluginRootPath
//     - File contains { key_id: string, signature: string } (base64 ed25519 sig)
//     - File mode is 0o600
//
//   readInstallSig(pluginRootPath): ReadInstallSigResult
//     - Returns { ok: true, file: InstallSigFile } on success
//     - Returns { ok: false, reason: string } on any failure — never throws
//
//   verifyInstallSig(pluginRootPath, sigFile, publicKey): Promise<VerifyInstallSigResult>
//     - Returns { ok: true } when sig is valid for fs.realpathSync(pluginRootPath)
//     - Returns { ok: false, reason: string } on any failure — never throws
//     - Fails when pluginRootPath does not exist (realpathSync fails)
//     - Fails when sig is valid base64 but wrong length (not 64 bytes)
//     - Fails when sig is 64 bytes but does not match payload/key
//
// FAIL-CLOSED: missing file, bad JSON, wrong shape, wrong-length sig, invalid sig
//   all produce { ok: false, reason } — never a silent pass.
//
// TEST INFRASTRUCTURE:
//   - Uses @noble/ed25519 keygenAsync() for ephemeral test keypairs
//   - Uses fs.mkdtempSync + os.tmpdir() for real temp dirs
//   - Cleans up temp dirs in afterEach
//   - Zero vi.mock — real file I/O throughout
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ed from "@noble/ed25519";

const { signPluginRoot, readInstallSig, verifyInstallSig, INSTALL_SIG_FILENAME } =
  await import("./install-sig.js").catch(() => ({
    signPluginRoot: undefined,
    readInstallSig: undefined,
    verifyInstallSig: undefined,
    INSTALL_SIG_FILENAME: undefined,
  }));

const moduleLoaded =
  typeof signPluginRoot === "function" &&
  typeof readInstallSig === "function" &&
  typeof verifyInstallSig === "function";

function requireImpl(name: string): void {
  if (!moduleLoaded) {
    throw new Error(
      `[WS-REVOKE-01] ${name}: install-sig.ts functions not yet exported. ` +
        `Create src/bootstrap/install-sig.ts to make this test pass.`
    );
  }
}

// ---------------------------------------------------------------------------
// Keypair helper — uses @noble/ed25519 keygenAsync() so the private key is
// the exact 32-byte seed format that signPluginRoot() expects.
// ---------------------------------------------------------------------------

interface NobleKeyPair {
  secretKey: Uint8Array; // 32-byte seed for @noble/ed25519
  publicKey: Uint8Array; // 32-byte public key
}

async function generateNobleKeyPair(): Promise<NobleKeyPair> {
  const { secretKey, publicKey } = await ed.keygenAsync();
  return { secretKey: new Uint8Array(secretKey), publicKey: new Uint8Array(publicKey) };
}

// ---------------------------------------------------------------------------
// Temp dir helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "teo-install-sig-test-"));
}

function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

// =============================================================================
// readInstallSig — MISUSE: file absent or unreadable
// =============================================================================

describe("readInstallSig — misuse: file absent → ok: false", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("returns ok: false when sig file does not exist", () => {
    requireImpl("readInstallSig: file absent");
    // No sig file written — directory is empty
    const result = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("returns ok: false for a completely non-existent directory", () => {
    requireImpl("readInstallSig: non-existent directory");
    const nonExistent = path.join(tmpDir, "does-not-exist");
    const result = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(
      nonExistent
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
    }
  });
});

// =============================================================================
// readInstallSig — BOUNDARY: file exists but contains bad content
// =============================================================================

describe("readInstallSig — boundary: file present but invalid content → ok: false", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("returns ok: false when sig file contains invalid JSON", () => {
    requireImpl("readInstallSig: invalid JSON");
    const sigFilePath = path.join(tmpDir, INSTALL_SIG_FILENAME as string);
    fs.writeFileSync(sigFilePath, "not valid json {{{{");

    const result = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
    }
  });

  it("returns ok: false when sig file is valid JSON but missing key_id", () => {
    requireImpl("readInstallSig: missing key_id");
    const sigFilePath = path.join(tmpDir, INSTALL_SIG_FILENAME as string);
    fs.writeFileSync(sigFilePath, JSON.stringify({ signature: "abc123" }));

    const result = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
    }
  });

  it("returns ok: false when sig file is valid JSON but missing signature", () => {
    requireImpl("readInstallSig: missing signature");
    const sigFilePath = path.join(tmpDir, INSTALL_SIG_FILENAME as string);
    fs.writeFileSync(sigFilePath, JSON.stringify({ key_id: "some-key" }));

    const result = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
    }
  });

  it("returns ok: false when sig file is null JSON", () => {
    requireImpl("readInstallSig: null JSON");
    const sigFilePath = path.join(tmpDir, INSTALL_SIG_FILENAME as string);
    fs.writeFileSync(sigFilePath, "null");

    const result = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
    }
  });

  it("returns ok: false when sig file is an array (wrong shape)", () => {
    requireImpl("readInstallSig: array shape");
    const sigFilePath = path.join(tmpDir, INSTALL_SIG_FILENAME as string);
    fs.writeFileSync(sigFilePath, JSON.stringify([{ key_id: "k", signature: "s" }]));

    const result = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
    }
  });

  it("returns ok: false when key_id is not a string (number instead)", () => {
    requireImpl("readInstallSig: key_id wrong type");
    const sigFilePath = path.join(tmpDir, INSTALL_SIG_FILENAME as string);
    fs.writeFileSync(sigFilePath, JSON.stringify({ key_id: 42, signature: "abc" }));

    const result = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
    }
  });
});

// =============================================================================
// readInstallSig — GOLDEN PATH: correct shape → ok: true
// =============================================================================

describe("readInstallSig — golden path: valid sig file → ok: true", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("returns ok: true and the parsed file when sig file has correct shape", () => {
    requireImpl("readInstallSig: valid file");
    const sigFilePath = path.join(tmpDir, INSTALL_SIG_FILENAME as string);
    const sigData = { key_id: "test-key-01", signature: "AAAA" };
    fs.writeFileSync(sigFilePath, JSON.stringify(sigData));

    const result = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.key_id).toBe("test-key-01");
      expect(result.file.signature).toBe("AAAA");
    }
  });
});

// =============================================================================
// verifyInstallSig — MISUSE: non-existent path → ok: false (realpathSync fails)
// =============================================================================

describe("verifyInstallSig — misuse: non-existent pluginRootPath → ok: false", () => {
  it("returns ok: false when pluginRootPath does not exist (realpathSync fails)", async () => {
    requireImpl("verifyInstallSig: non-existent path");
    const nonExistentPath = "/tmp/teo-absolutely-does-not-exist-" + Date.now();
    const sigFile = { key_id: "k", signature: Buffer.alloc(64).toString("base64") };

    const result = await (verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig)(
      nonExistentPath,
      sigFile,
      new Uint8Array(32)
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// verifyInstallSig — BOUNDARY: wrong-length sig (valid base64, != 64 bytes)
// Covers line 185 in install-sig.ts
// =============================================================================

describe("verifyInstallSig — boundary: valid base64 but wrong length → ok: false", () => {
  let tmpDir: string;
  let kp: NobleKeyPair;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    kp = await generateNobleKeyPair();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("returns ok: false when sig is valid base64 but only 32 bytes (too short)", async () => {
    requireImpl("verifyInstallSig: 32-byte sig");
    // 32 random bytes base64-encoded — not 64 bytes
    const shortSig = Buffer.alloc(32, 0xaa).toString("base64");
    const sigFile = { key_id: "test-key", signature: shortSig };

    const realTmpDir = fs.realpathSync(tmpDir);
    const result = await (verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig)(
      realTmpDir,
      sigFile,
      kp.publicKey
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/wrong length/);
    }
  });

  it("returns ok: false when sig is valid base64 but 1 byte (minimal short)", async () => {
    requireImpl("verifyInstallSig: 1-byte sig");
    const oneByteSig = Buffer.alloc(1, 0xff).toString("base64");
    const sigFile = { key_id: "test-key", signature: oneByteSig };

    const realTmpDir = fs.realpathSync(tmpDir);
    const result = await (verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig)(
      realTmpDir,
      sigFile,
      kp.publicKey
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
    }
  });

  it("returns ok: false when sig is valid base64 but 128 bytes (too long)", async () => {
    requireImpl("verifyInstallSig: 128-byte sig");
    const longSig = Buffer.alloc(128, 0xbb).toString("base64");
    const sigFile = { key_id: "test-key", signature: longSig };

    const realTmpDir = fs.realpathSync(tmpDir);
    const result = await (verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig)(
      realTmpDir,
      sigFile,
      kp.publicKey
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/wrong length/);
    }
  });
});

// =============================================================================
// verifyInstallSig — BOUNDARY: sig is 64 bytes but cryptographically invalid
// Covers line 208 in install-sig.ts (!valid → ok: false)
// =============================================================================

describe("verifyInstallSig — boundary: 64-byte sig but cryptographically invalid → ok: false", () => {
  let tmpDir: string;
  let kp: NobleKeyPair;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    kp = await generateNobleKeyPair();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("returns ok: false when sig is 64 garbage bytes (not a valid ed25519 sig)", async () => {
    requireImpl("verifyInstallSig: garbage 64-byte sig");
    // 64 bytes of 0x42 — valid base64, correct length, cryptographically wrong
    const garbageSig = Buffer.alloc(64, 0x42).toString("base64");
    const sigFile = { key_id: "test-key", signature: garbageSig };

    const realTmpDir = fs.realpathSync(tmpDir);
    const result = await (verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig)(
      realTmpDir,
      sigFile,
      kp.publicKey
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/verification failed/i);
    }
  });

  it("returns ok: false when sig is from a DIFFERENT keypair (64-byte, valid format, wrong key)", async () => {
    requireImpl("verifyInstallSig: sig from different keypair");
    const otherKp = await generateNobleKeyPair();
    // Sign with otherKp.secretKey, verify with kp.publicKey — mismatch
    const canonicalPath = fs.realpathSync(tmpDir);
    const payloadBytes = new Uint8Array(Buffer.from(canonicalPath, "utf8"));
    const sigBytes = await ed.signAsync(payloadBytes, otherKp.secretKey);
    const sigFile = {
      key_id: "test-key",
      signature: Buffer.from(sigBytes).toString("base64"),
    };

    const result = await (verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig)(
      canonicalPath,
      sigFile,
      kp.publicKey
    ); // kp.publicKey, not otherKp.publicKey

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/verification failed/i);
    }
  });

  it("returns ok: false when sig is correct for a DIFFERENT path (path tamper)", async () => {
    requireImpl("verifyInstallSig: sig for different path");
    // Sign "/wrong/path" bytes, then verify against actual tmpDir
    const wrongPath = "/wrong/path/that/was/signed";
    const payloadBytes = new Uint8Array(Buffer.from(wrongPath, "utf8"));
    const sigBytes = await ed.signAsync(payloadBytes, kp.secretKey);
    const sigFile = {
      key_id: "test-key",
      signature: Buffer.from(sigBytes).toString("base64"),
    };

    const realTmpDir = fs.realpathSync(tmpDir);
    const result = await (verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig)(
      realTmpDir,
      sigFile,
      kp.publicKey
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/verification failed/i);
    }
  });
});

// =============================================================================
// signPluginRoot — GOLDEN PATH: writes sig file with correct shape and mode
// Covers line 81 in install-sig.ts (fs.writeFileSync with mode 0o600)
// =============================================================================

describe("signPluginRoot — golden path: writes sig file correctly", () => {
  let tmpDir: string;
  let kp: NobleKeyPair;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    kp = await generateNobleKeyPair();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("creates the sig file in the plugin root directory", async () => {
    requireImpl("signPluginRoot: creates file");
    const realTmpDir = fs.realpathSync(tmpDir);

    await (signPluginRoot as typeof import("./install-sig.js").signPluginRoot)(
      realTmpDir,
      "test-key-id",
      kp.secretKey
    );

    const sigFilePath = path.join(realTmpDir, INSTALL_SIG_FILENAME as string);
    expect(fs.existsSync(sigFilePath)).toBe(true);
  });

  it("sig file contains valid JSON with key_id and signature fields", async () => {
    requireImpl("signPluginRoot: JSON shape");
    const realTmpDir = fs.realpathSync(tmpDir);

    await (signPluginRoot as typeof import("./install-sig.js").signPluginRoot)(
      realTmpDir,
      "my-key-id",
      kp.secretKey
    );

    const sigFilePath = path.join(realTmpDir, INSTALL_SIG_FILENAME as string);
    const raw = fs.readFileSync(sigFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    expect(parsed).not.toBeNull();
    expect(typeof parsed).toBe("object");
    expect((parsed as Record<string, unknown>)["key_id"]).toBe("my-key-id");
    expect(typeof (parsed as Record<string, unknown>)["signature"]).toBe("string");
  });

  it("sig file has mode 0o600 (owner read/write only)", async () => {
    requireImpl("signPluginRoot: file mode 0o600");
    const realTmpDir = fs.realpathSync(tmpDir);

    await (signPluginRoot as typeof import("./install-sig.js").signPluginRoot)(
      realTmpDir,
      "key-id",
      kp.secretKey
    );

    const sigFilePath = path.join(realTmpDir, INSTALL_SIG_FILENAME as string);
    const stat = fs.statSync(sigFilePath);
    // stat.mode & 0o777 masks off file-type bits; 0o600 = owner read+write
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("sig file signature is exactly 64 bytes when decoded from base64", async () => {
    requireImpl("signPluginRoot: sig is 64 bytes");
    const realTmpDir = fs.realpathSync(tmpDir);

    await (signPluginRoot as typeof import("./install-sig.js").signPluginRoot)(
      realTmpDir,
      "key-id",
      kp.secretKey
    );

    const sigFilePath = path.join(realTmpDir, INSTALL_SIG_FILENAME as string);
    const parsed = JSON.parse(fs.readFileSync(sigFilePath, "utf8")) as {
      key_id: string;
      signature: string;
    };
    const sigBytes = Buffer.from(parsed.signature, "base64");
    expect(sigBytes.length).toBe(64);
  });
});

// =============================================================================
// verifyInstallSig — GOLDEN PATH: valid sig over real path → ok: true
// Covers line 226 in install-sig.ts (return { ok: true })
// =============================================================================

describe("verifyInstallSig — golden path: valid sig over real path → ok: true", () => {
  let tmpDir: string;
  let kp: NobleKeyPair;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    kp = await generateNobleKeyPair();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("returns ok: true when sig was created by signPluginRoot and matches the path", async () => {
    requireImpl("verifyInstallSig: golden path via signPluginRoot");
    const realTmpDir = fs.realpathSync(tmpDir);

    // Step 1: sign the plugin root
    await (signPluginRoot as typeof import("./install-sig.js").signPluginRoot)(
      realTmpDir,
      "verify-key-id",
      kp.secretKey
    );

    // Step 2: read back the sig file
    const readResult = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(
      realTmpDir
    );
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    // Step 3: verify the sig
    const verifyResult = await (
      verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig
    )(realTmpDir, readResult.file, kp.publicKey);

    expect(verifyResult.ok).toBe(true);
  });

  it("ok: true for a manually crafted sig over the real path (validates the exact payload)", async () => {
    requireImpl("verifyInstallSig: golden path manual sig");
    const realTmpDir = fs.realpathSync(tmpDir);

    // Manually sign the canonical path (same as signPluginRoot does internally)
    const canonicalPath = fs.realpathSync(realTmpDir);
    const payloadBytes = new Uint8Array(Buffer.from(canonicalPath, "utf8"));
    const sigBytes = await ed.signAsync(payloadBytes, kp.secretKey);

    const sigFile = {
      key_id: "manual-key",
      signature: Buffer.from(sigBytes).toString("base64"),
    };

    const result = await (verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig)(
      realTmpDir,
      sigFile,
      kp.publicKey
    );

    expect(result.ok).toBe(true);
  });

  it("ok: true result carries no reason field (PASS has no error reason)", async () => {
    requireImpl("verifyInstallSig: ok: true has no reason");
    const realTmpDir = fs.realpathSync(tmpDir);

    await (signPluginRoot as typeof import("./install-sig.js").signPluginRoot)(
      realTmpDir,
      "key-id",
      kp.secretKey
    );

    const readResult = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(
      realTmpDir
    );
    if (!readResult.ok) throw new Error("readInstallSig unexpectedly failed in golden path test");

    const verifyResult = await (
      verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig
    )(realTmpDir, readResult.file, kp.publicKey);

    expect(verifyResult.ok).toBe(true);
    // { ok: true } shape has no reason field
    expect(Object.keys(verifyResult)).toEqual(["ok"]);
  });

  it("two independent keypairs each sign their own path and both verify successfully", async () => {
    requireImpl("verifyInstallSig: two independent keypairs");
    const tmpDir2 = makeTempDir();
    let kp2: NobleKeyPair | undefined;
    try {
      kp2 = await generateNobleKeyPair();
      const realDir1 = fs.realpathSync(tmpDir);
      const realDir2 = fs.realpathSync(tmpDir2);

      await (signPluginRoot as typeof import("./install-sig.js").signPluginRoot)(
        realDir1,
        "kp1-key",
        kp.secretKey
      );
      await (signPluginRoot as typeof import("./install-sig.js").signPluginRoot)(
        realDir2,
        "kp2-key",
        kp2.secretKey
      );

      const read1 = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(realDir1);
      const read2 = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(realDir2);
      if (!read1.ok || !read2.ok) throw new Error("readInstallSig failed in multi-kp test");

      const [verify1, verify2] = await Promise.all([
        (verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig)(
          realDir1,
          read1.file,
          kp.publicKey
        ),
        (verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig)(
          realDir2,
          read2.file,
          kp2.publicKey
        ),
      ]);

      expect(verify1.ok).toBe(true);
      expect(verify2.ok).toBe(true);
    } finally {
      removeTempDir(tmpDir2);
    }
  });
});

// =============================================================================
// End-to-end round-trip: signPluginRoot → readInstallSig → verifyInstallSig
// =============================================================================

describe("install-sig end-to-end round-trip", () => {
  let tmpDir: string;
  let kp: NobleKeyPair;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    kp = await generateNobleKeyPair();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("full round-trip: sign → read → verify succeeds", async () => {
    requireImpl("round-trip: sign-read-verify");
    const realDir = fs.realpathSync(tmpDir);

    await (signPluginRoot as typeof import("./install-sig.js").signPluginRoot)(
      realDir,
      "rt-key",
      kp.secretKey
    );

    const readResult = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(
      realDir
    );
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;
    expect(readResult.file.key_id).toBe("rt-key");

    const verifyResult = await (
      verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig
    )(realDir, readResult.file, kp.publicKey);
    expect(verifyResult.ok).toBe(true);
  });

  it("verify fails when public key does not match signing key (cross-key attack)", async () => {
    requireImpl("round-trip: wrong pubkey → verify fails");
    const realDir = fs.realpathSync(tmpDir);
    const wrongKp = await generateNobleKeyPair();

    await (signPluginRoot as typeof import("./install-sig.js").signPluginRoot)(
      realDir,
      "rt-key",
      kp.secretKey
    );

    const readResult = (readInstallSig as typeof import("./install-sig.js").readInstallSig)(
      realDir
    );
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    // Verify with a different public key — must fail
    const verifyResult = await (
      verifyInstallSig as typeof import("./install-sig.js").verifyInstallSig
    )(realDir, readResult.file, wrongKp.publicKey);
    expect(verifyResult.ok).toBe(false);
  });
});
