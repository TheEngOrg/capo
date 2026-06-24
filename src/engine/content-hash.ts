// WS-SEC-01 — computeContentHash() directory tree SHA-256 utility
// WS-CRYPTO-03 — per-file size cap (skipped_count, ContentHashResult)
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Directory names to skip at any depth (to prevent OOM on large dirs). */
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".teo", "dist", ".next", "coverage"]);

/** Default per-file size cap: files larger than this are skipped during hashing. */
export const FILE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

/** Result shape returned by computeContentHash on success. */
export interface ContentHashResult {
  hash: string;
  skipped_count: number;
}

export function computeContentHash(
  dirPath: string,
  opts?: { fileSizeLimitBytes?: number }
): Promise<ContentHashResult | null> {
  const limit = opts?.fileSizeLimitBytes ?? FILE_SIZE_LIMIT_BYTES;

  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }

  try {
    const files = collectFiles(dirPath).sort();
    const hash = crypto.createHash("sha256");
    let skipped_count = 0;
    for (const filePath of files) {
      const fileSize = fs.statSync(filePath).size;
      if (fileSize > limit) {
        console.warn(
          `[content-hash] skipping oversized file: ${filePath} (${fileSize} bytes > ${limit} byte limit)`
        );
        skipped_count++;
        continue;
      }
      const relPath = path.relative(dirPath, filePath);
      hash.update(relPath);
      hash.update(":");
      const content = fs.readFileSync(filePath);
      hash.update(content);
    }
    return Promise.resolve({ hash: hash.digest("hex"), skipped_count });
  } catch {
    return Promise.resolve(null);
  }
}

function collectFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue; // WS-CRYPTO-01: skip large/binary dirs
      files.push(...collectFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}
