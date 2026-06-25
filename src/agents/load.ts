// =============================================================================
// load.ts — Agent roster loader (WS-P1-06)
//
// Reads agent definition .md files from src/agents/ and returns parsed,
// validated AgentDefinition objects.
//
// FRONTMATTER PARSING: Inline parser — no YAML dep added. The frontmatter
// format used by these files is a flat subset of YAML: scalar key: value
// pairs and a single YAML block-sequence (disallowedTools_default). No
// nesting, no multi-line values, no anchors. A bespoke parser keeps the dep
// count minimal and is the right tradeoff for this stable, controlled format.
//
// PATH-TRAVERSAL GUARD: id is validated against "..", "/", and "\" BEFORE
// any path construction. The error message does NOT echo the raw input.
//
// CRITICAL-PATH: This module is on the roster provisioning path. 100% branch
// coverage is required (see vitest.config.ts perFile thresholds).
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "../lib/schema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  agent_id: string;
  name: string;
  role: string;
  disallowedTools_default: string[];
  body: string;
}

// ---------------------------------------------------------------------------
// Zod schema for frontmatter validation
// ---------------------------------------------------------------------------

const FrontmatterSchema = z.object({
  agent_id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  disallowedTools_default: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Default directory — resolved relative to this file, not process.cwd()
// ---------------------------------------------------------------------------

const DEFAULT_AGENTS_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Inline frontmatter parser
// ---------------------------------------------------------------------------

interface ParsedFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Parses a .md file with YAML frontmatter delimited by "---\n ... ---\n".
 * Supports flat scalar values and a single block-sequence field
 * (disallowedTools_default). Throws on missing or unclosed delimiters.
 */
function parseMd(content: string): ParsedFile {
  // Must start with "---\n"
  if (!content.startsWith("---\n")) {
    throw new Error("Frontmatter missing: file must begin with '---' delimiter.");
  }

  const afterOpen = content.slice(4); // drop the opening "---\n"
  const closeIdx = afterOpen.indexOf("\n---\n");

  if (closeIdx === -1) {
    throw new Error("Frontmatter unclosed: missing closing '---' delimiter.");
  }

  const yamlBlock = afterOpen.slice(0, closeIdx);
  const body = afterOpen.slice(closeIdx + 5); // 5 = "\n---\n".length

  const frontmatter = parseYamlFlat(yamlBlock);
  return { frontmatter, body };
}

/**
 * Parses the minimal flat YAML subset used in agent frontmatter:
 *   - Scalar: `key: value`
 *   - Block sequence: `key:\n  - item\n  - item`
 *
 * Keys with empty values are recorded as empty strings. Only one level of
 * indented list items is supported.
 */
function parseYamlFlat(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // Filter blank/comment lines upfront so the main loop has no dead branches.
  const lines = yaml.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));

  for (let i = 0; i < lines.length; ) {
    const line = lines[i] as string;

    // Top-level key: value  (no leading whitespace)
    const scalarMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    /* c8 ignore next 4 */
    if (!scalarMatch) {
      i++;
      continue;
    }

    const key = scalarMatch[1] as string;
    const rawVal = (scalarMatch[2] as string).trim();

    if (rawVal === "") {
      // Possible block-sequence: collect "  - item" lines that follow
      const listItems: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s+(.+)$/.test(lines[j] as string)) {
        const itemMatch = /^\s+-\s+(.+)$/.exec(lines[j] as string);
        /* c8 ignore next */
        listItems.push((itemMatch?.[1] as string).trim());
        j++;
      }
      result[key] = listItems;
      i = j;
    } else {
      // Scalar value — strip optional surrounding quotes
      result[key] = rawVal.replace(/^["']|["']$/g, "");
      i++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Path-traversal guard
// ---------------------------------------------------------------------------

const TRAVERSAL_RE = /\.\.|\/|\\/;

function assertSafeId(id: string): void {
  if (TRAVERSAL_RE.test(id)) {
    throw new Error(
      "Invalid agent id: id must not contain path separators or traversal sequences."
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads and validates an agent definition by id.
 *
 * @param id  - Stem name of the agent (e.g. "capo", "dev"). Must not contain
 *              "..", "/", or "\".
 * @param dir - Directory to search. Defaults to the bundled src/agents/
 *              directory (resolved relative to this file).
 */
export function loadAgentDefinition(id: string, dir?: string): AgentDefinition {
  assertSafeId(id);

  const agentsDir = dir ?? DEFAULT_AGENTS_DIR;
  const filePath = path.join(agentsDir, `${id}.md`);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    throw new Error(`Unknown agent id "${id}": file not found at expected path.`, { cause: e });
  }

  let parsed: ParsedFile;
  try {
    parsed = parseMd(raw);
  } catch (e) {
    throw new Error(`Failed to parse frontmatter for agent "${id}": ${String(e)}`, { cause: e });
  }

  const validated = FrontmatterSchema.safeParse(parsed.frontmatter);
  if (!validated.success) {
    throw new Error(`Invalid frontmatter for agent "${id}": ${validated.error.message}`);
  }

  const fm = validated.data;

  if (fm.agent_id !== id) {
    throw new Error(
      `agent_id mismatch: file is named "${id}" but frontmatter declares agent_id "${fm.agent_id}". Rename one to match the other.`
    );
  }

  return {
    agent_id: fm.agent_id,
    name: fm.name,
    role: fm.role,
    disallowedTools_default: fm.disallowedTools_default,
    body: parsed.body,
  };
}

/**
 * Returns the stem names of all *.md files in the agents directory.
 *
 * @param dir - Directory to search. Defaults to the bundled src/agents/
 *              directory (resolved relative to this file).
 */
export function listAgentIds(dir?: string): string[] {
  const agentsDir = dir ?? DEFAULT_AGENTS_DIR;
  const entries = fs.readdirSync(agentsDir);
  return entries.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -".md".length));
}
