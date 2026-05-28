# Release Pipeline Signing — Implementation Spec

**Status:** DRAFT  
**Date:** 2026-05-21  
**Author:** DevOps Engineer  
**Feeding workstream:** Week 4 — Release Pipeline  
**Implements:** ADR-0001 Part 2, "Public key pinning" and "Tamper enforcement posture"  
**Resolves:** ADR-0001 OQ-3 (signing key storage and CI secret name), OQ-4 (public key embedding approach)

---

## Overview

This spec defines how TEO v1 release artifacts are signed with an Ed25519 keypair and how the verification public key is compiled into the binary at build time. It does not restate policy — that lives in ADR-0001. It answers the concrete implementation questions the Week 4 pipeline workstream needs before writing a line of CI YAML.

The user-resolved decision: **GitHub Secrets for v1.** KMS is out of scope. The rationale and accepted limitations are documented in Section 7.

---

## 1. GH Secret Naming and Scoping

### Canonical secret name

```
TEO_RELEASE_SIGNING_KEY
```

Contents: the Ed25519 private key in PEM format (base64-encoded, single-line for secret storage). See Section 2 for generation format.

### Scope recommendation: environment-level, not repository-level

**Recommendation: environment-level secret scoped to a `release` environment.**

Rationale:

- Repository-level secrets are accessible to any workflow job in any branch. A compromised branch or a malicious PR that modifies `release.yml` can exfiltrate the key during a pull request CI run.
- Environment-level secrets with required reviewers (GitHub environment protection rules) gate secret access behind human approval. Only jobs that explicitly reference `environment: release` can read `TEO_RELEASE_SIGNING_KEY`.
- Protected branch enforcement on `main` combined with environment protection on `release` means the private key is accessible only to approved, merged release workflows.

Setup steps:

1. In GitHub repo settings: **Environments** → create environment named `release`.
2. Add a required reviewer (repo owner or a named team).
3. Set `Deployment branches` to protected branches only (i.e., `main`).
4. Add `TEO_RELEASE_SIGNING_KEY` as an environment secret (not a repository secret).

If the repository is private and the team is small with no external contributors, repository-level is acceptable as a simpler fallback. Document the trade-off in the repo's `SECURITY.md` if that path is taken.

---

## 2. Key Generation Runbook (One-Time Setup)

This is a human-executed runbook. It is not automated. Run it once before the first v1 release.

### 2a. Generate the Ed25519 keypair

```sh
# Generate private key
openssl genpkey -algorithm ed25519 -out teo-release-signing.pem

# Derive the public key
openssl pkey -in teo-release-signing.pem -pubout -out teo-release-signing.pub.pem
```

Both files are created locally. The private key file (`teo-release-signing.pem`) never leaves the machine used to generate it — it is loaded into GH Secrets and then deleted from disk.

### 2b. Load the private key into GH Secrets

```sh
# Verify the key is valid before loading
openssl pkey -in teo-release-signing.pem -check -noout

# Store as GH environment secret (requires gh CLI, authenticated)
gh secret set TEO_RELEASE_SIGNING_KEY \
  --env release \
  --body "$(cat teo-release-signing.pem)"
```

Confirm it appears in the `release` environment secrets list:

```sh
gh secret list --env release
```

### 2c. Capture the public key for compile-time embedding

```sh
# Print the public key — this is what gets committed to the repo
cat teo-release-signing.pub.pem
```

Copy the full PEM block. This is the value embedded in source per Section 4.

### 2d. Cleanup

```sh
# Securely delete the private key from local disk
# macOS
rm -P teo-release-signing.pem

# Linux (if srm unavailable)
shred -u teo-release-signing.pem
```

The public key file (`teo-release-signing.pub.pem`) can be retained locally or deleted — it is also committed to the repo (see Section 4).

---

## 3. How `teo-build-release` Consumes the Secret

### Which CI job calls it

The signing step runs in `.github/workflows/release.yml` in a dedicated job named `sign-and-package` (see Section 5 for full job layout). The `teo-build-release` script is invoked from this job after the build artifacts are produced.

### Secret injection

The job declares `environment: release`, which makes `TEO_RELEASE_SIGNING_KEY` available as a secret. It is injected as an environment variable:

```yaml
env:
  TEO_RELEASE_SIGNING_KEY: ${{ secrets.TEO_RELEASE_SIGNING_KEY }}
```

The variable is available only within the `sign-and-package` job. No other job in the workflow has access.

### What `teo-build-release` signs

`teo-build-release` is responsible for two signing operations before it packages the tarball:

1. **Sign `agents.json` → produce `agents.lock`**: The manifest JSON is signed; the detached signature becomes `agents.lock`. The binary verifies `agents.lock` at startup against the compiled-in public key.

2. **Sign the tarball manifest**: After the tarball is assembled, a `SHA256SUMS` file is signed to produce `SHA256SUMS.sig`. This is the installer integrity check.

### Signing command (no extra install required)

`openssl pkeyutl` with Ed25519 is available in OpenSSL 1.1.1+ and is present on all standard GitHub Actions `ubuntu-latest` runners without additional install steps.

Sign `agents.json`:

```sh
# Write the PEM key from env to a temp file (mode 0600, auto-cleaned)
SIGNING_KEY_FILE=$(mktemp)
chmod 600 "$SIGNING_KEY_FILE"
printf '%s' "$TEO_RELEASE_SIGNING_KEY" > "$SIGNING_KEY_FILE"

# Sign
openssl pkeyutl \
  -sign \
  -inkey "$SIGNING_KEY_FILE" \
  -rawin \
  -in agents.json \
  -out agents.lock

# Clean up key from disk immediately after signing
rm -f "$SIGNING_KEY_FILE"
```

Sign the tarball manifest:

```sh
SIGNING_KEY_FILE=$(mktemp)
chmod 600 "$SIGNING_KEY_FILE"
printf '%s' "$TEO_RELEASE_SIGNING_KEY" > "$SIGNING_KEY_FILE"

openssl pkeyutl \
  -sign \
  -inkey "$SIGNING_KEY_FILE" \
  -rawin \
  -in SHA256SUMS \
  -out SHA256SUMS.sig

rm -f "$SIGNING_KEY_FILE"
```

The `-rawin` flag is required for Ed25519 (it signs raw bytes, not a digest — Ed25519 handles the hash internally).

`teo-build-release` wraps these commands. The raw `openssl pkeyutl` calls above are the canonical reference — the script should not add intermediate steps or pipe through additional tools that could modify the byte stream.

---

## 4. Public Key Embedding at Build Time

### Requirement from ADR-0001

> "The verification public key for `agents.lock` and `teo.lic` signature validation is compiled into the binary at build time. There is no file-based key path."

The private key NEVER appears in source. Only the public key is embedded. Committing the public key is safe and correct — it is derived to be public.

### Options evaluated

**Option A — Bun `--define` flag at build time**

Pass the public key as a compile-time constant via `bun build --define 'RELEASE_PUBLIC_KEY="..."'`. The constant is inlined by the bundler. No committed file needed — the key is injected at CI build time from an environment variable (or the committed `.pub.pem` file).

Limitation: multi-line PEM strings require escaping. The `--define` value must be a single-line JSON string literal, so the PEM must be base64-encoded to a single line before injection. Adds a transformation step with a failure mode (truncated key silently passes a string type check but fails at runtime).

**Option B — Generated TypeScript constant file committed to repo**

A file `packages/core/src/security/release-public-key.ts` is committed to the repo containing:

```typescript
// Auto-generated — do not edit by hand.
// Public key for agents.lock and teo.lic signature verification.
// This is not a secret. The corresponding private key is held in CI only.
export const RELEASE_PUBLIC_KEY = `
-----BEGIN PUBLIC KEY-----
<base64-encoded public key>
-----END PUBLIC KEY-----
`.trim();
```

The binary imports this constant directly. No build-time flag needed. The key is part of the source tree and tracked in git.

**Option C — Generated header / JSON file**

A `release-public-key.json` or similar is committed. Functionally equivalent to Option B but requires an extra read at startup or an import shim. No meaningful advantage over Option B for a TypeScript/Bun codebase.

### Recommendation: Option B

Commit a TypeScript constant file to the repo.

Rationale:

- No build-time flag complexity. The key is in the source tree, visible in PR review, auditable in git history, and picked up by the TypeScript compiler as a normal import.
- The `--define` escape complexity in Option A is a real failure mode (key truncation, encoding errors) with no compensating advantage — we are not trying to keep the public key out of the repo.
- The committed file is the right artifact for this: the public key is as permanent as the signing architecture itself, it should be reviewed when it changes, and git history gives us an authoritative record of when the key changed.
- Key rotation (STORY-KEY-ROTATION, see Section 6) naturally follows: update the file, commit, PR review, release. The git record is the rotation event log.

The file lives at: `packages/core/src/security/release-public-key.ts`

It is committed once after the keypair generation runbook (Section 2c). It is updated only on key rotation.

---

## 5. CI Matrix and Job Scoping

### Workflow file

`.github/workflows/release.yml` — extend the existing file, do not create a parallel workflow.

### Job layout

```
build
  └── sign-and-package   (environment: release — TEO_RELEASE_SIGNING_KEY scoped here only)
        └── upload-artifacts
```

`sign-and-package` explicitly `needs: [build]` so it never runs before artifacts are produced.

### Secret scope: principle of least privilege

Only `sign-and-package` declares `environment: release`. The `build` and `upload-artifacts` jobs do NOT reference the `release` environment and cannot access `TEO_RELEASE_SIGNING_KEY`.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    # No environment declaration — no access to TEO_RELEASE_SIGNING_KEY
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: pnpm build

  sign-and-package:
    needs: [build]
    runs-on: ubuntu-latest
    environment: release              # <-- only this job has key access
    env:
      TEO_RELEASE_SIGNING_KEY: ${{ secrets.TEO_RELEASE_SIGNING_KEY }}
    steps:
      - name: Sign agents.json
        run: .claude/scripts/teo-build-release --sign-only
      - name: Package tarball
        run: .claude/scripts/teo-build-release --package

  upload-artifacts:
    needs: [sign-and-package]
    runs-on: ubuntu-latest
    # No environment declaration
    steps:
      - name: Upload release assets
        run: gh release upload ${{ github.ref_name }} dist/*.tar.gz SHA256SUMS SHA256SUMS.sig agents.lock
```

The CI environment explicitly does NOT set `TEO_DEV_MODE=1`. Binary exits non-zero on any integrity violation per ADR-0001 Part 2 D3 (CI policy constraint).

---

## 6. Key Rotation Runbook (STORY-KEY-ROTATION — Document Only)

Key rotation is out of scope for v1. This section documents what rotation requires so it is not designed ad hoc when needed.

**What key rotation requires:**

1. Generate a new Ed25519 keypair (Section 2a).
2. Update `TEO_RELEASE_SIGNING_KEY` in the GH `release` environment secret.
3. Update `packages/core/src/security/release-public-key.ts` with the new public key. Open a PR — this is an audited change in git history.
4. Build and release a new binary. The old binary cannot verify artifacts signed with the new key.
5. Re-sign all release artifacts that need to remain verifiable (if backward compatibility of older artifacts matters — likely it does not at v1 scale).
6. Revoke and delete the old private key.

**Key implication:** every active installation of the binary must update to the new binary before it can install any post-rotation release. There is no in-place key update mechanism at v1. This is the cost of compiling the key into the binary — it is the correct SOC2 trade-off at v1 scale, and it is what STORY-KEY-ROTATION exists to design around for broader distribution.

**Tracked as:** STORY-KEY-ROTATION. Reference this story before any community distribution of the binary.

---

## 7. Cost Analysis: GH Secrets vs KMS

### GH Secrets

- **Cost:** $0 at free tier, $0 at Team/Enterprise tier (secrets are included).
- **Limits:** Secret value size: 64 KB (Ed25519 PEM keys are ~200 bytes — no concern). No per-secret TTL or automatic rotation. No HSM-backed storage. No native audit trail for secret reads (GitHub audit log shows secret creation/deletion but not individual reads in workflow runs).
- **Security model:** Secret is encrypted at rest by GitHub using NaCl sealed boxes. Accessible only to jobs that reference the environment. Not exposed in logs (GitHub masks the value). Private to the repository.

### KMS (AWS KMS or GCP Cloud KMS)

- **Cost:** AWS KMS: $1.00/month per CMK + $0.03 per 10,000 API calls. GCP KMS: $0.06/month per key version + $0.03 per 10,000 operations. At TEO's estimated v1 release cadence (4–12 releases/year), API call cost is negligible. The dominant cost is the per-key monthly fee.
- **Annual cost delta:** ~$12–15/year (AWS) or ~$0.72–1/year (GCP) vs $0 for GH Secrets.
- **What KMS adds:** HSM-backed key storage (FIPS 140-2 Level 2/3). Automatic key rotation support. Per-operation audit trail in CloudTrail / Cloud Audit Logs. Key never leaves the KMS boundary — CI calls the KMS API to sign; the raw key is never materialized in the runner environment.
- **What KMS does not add at v1 scale:** Multi-user key governance (not needed — one release pipeline, one key). Customer-managed encryption (not needed — we own the repo). Cross-region availability (not needed — one release job).

### Annual cost delta at v1 release cadence

| Option | Annual cost | Key in runner memory | Audit trail | HSM |
|--------|-------------|----------------------|-------------|-----|
| GH Secrets | $0 | Yes (temp file, seconds) | No per-read trail | No |
| AWS KMS | ~$12–15 | No | Yes (CloudTrail) | Yes |
| GCP KMS | ~$1 | No | Yes (Cloud Audit Logs) | Yes |

### Recommendation: GH Secrets confirmed for v1

The user's choice of GH Secrets is correct for v1. The $12–15/year KMS cost is not the deciding factor — the deciding factor is operational complexity. KMS introduces an AWS/GCP account dependency, IAM role configuration in CI, and a harder-to-reproduce local debug path. At a release cadence of 4–12 times per year with a small controlled distribution, the security delta does not justify the operational overhead.

GCP KMS at ~$1/year is worth revisiting before STORY-KEY-ROTATION ships — the cost is trivial and the HSM guarantee meaningfully strengthens the SOC2 story for broader distribution.

The limitations accepted at v1 are listed in the next section.

---

## Limitations Accepted at v1

These are the trade-offs the team explicitly accepts by choosing GH Secrets over KMS.

| Limitation | Impact | Mitigated by |
|-----------|--------|--------------|
| Private key materializes in runner memory (temp file) during signing | Key could be read by other processes on the shared runner during the signing window | Temp file is `chmod 0600`, deleted immediately after signing; GitHub's ephemeral runners recycle between jobs |
| No per-read audit trail for secret access | Cannot prove in a SOC2 audit exactly when and how many times the key was used | GitHub Actions audit log shows workflow runs; the signed artifact timestamps serve as the usage record |
| No HSM backing | Key is encrypted at rest by GitHub software, not dedicated hardware | Acceptable for v1 controlled distribution; revisit before SOC2 Type II or broad community release |
| No automatic key rotation | Rotation is a manual, coordinated, binary-release event (see STORY-KEY-ROTATION) | Controlled distribution model means forced rotation via binary release is practical at v1 scale |
| 64 KB secret size limit | Not a current concern (Ed25519 PEM is ~200 bytes) | N/A |
| GH Secrets not portable to self-hosted CI | Any future migration off GitHub Actions requires re-architecting secret access | Acceptable; GitHub Actions is the committed CI platform for v1 |

These limitations are acceptable for v1. They are recorded here — not buried — so the team knows what we're working with going into a SOC2 Type II conversation or a community distribution decision.
