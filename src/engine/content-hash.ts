// WS-SEC-01 — computeContentHash() directory tree SHA-256 utility
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Directory names to skip at any depth (to prevent OOM on large dirs). */
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".teo", "dist", ".next", "coverage"]);

export function computeContentHash(dirPath: string): Promise<string | null> {
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }

  try {
    const files = collectFiles(dirPath).sort();
    const hash = crypto.createHash("sha256");
    for (const filePath of files) {
      const relPath = path.relative(dirPath, filePath);
      hash.update(relPath);
      hash.update(":");
      const content = fs.readFileSync(filePath);
      hash.update(content);
    }
    return Promise.resolve(hash.digest("hex"));
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
