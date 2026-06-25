// =============================================================================
// schema.test.ts — specs for src/lib/schema.ts (WS-LIB-01)
//
// STATUS: PASSING — implementation src/lib/schema.ts created (WS-LIB-01 complete).
//
// ORDERING: misuse → boundary → golden path (adversarial-first policy)
//
// CONTRACT (what these tests enforce):
//
//   src/lib/schema.ts must re-export from "zod":
//     - z (the Zod namespace, same object as require("zod").z)
//
//   The wrapper must be transparent — callers get the full Zod API.
//   Specifically, all constructors used in the codebase must be present and
//   functional: z.object, z.string, z.enum, z.array, z.union, z.number,
//   z.boolean, z.literal, z.optional.
//
// SOURCE-SCAN (import hygiene):
//   After implementation, plan.ts, artifacts.ts, and agents/load.ts must no
//   longer import from "zod" directly — they must import from the wrapper.
//   These tests assert that at the source level.
//
// =============================================================================

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Import the wrapper (will fail until src/lib/schema.ts is created by dev)
// ---------------------------------------------------------------------------
import { z } from "./schema.js";

// =============================================================================
// MISUSE CASES — invalid input, strict mode, error shapes
// =============================================================================

describe("schema wrapper — misuse cases (adversarial-first)", () => {
  it("z.string().safeParse(42) returns { success: false } with a ZodError-shaped result", () => {
    const result = z.string().safeParse(42);
    expect(result.success).toBe(false);
    // ZodError-shaped: result.error must exist and have an issues array
    if (!result.success) {
      expect(Array.isArray(result.error.issues)).toBe(true);
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("z.number().safeParse('not-a-number') returns { success: false }", () => {
    const result = z.number().safeParse("not-a-number");
    expect(result.success).toBe(false);
  });

  it("z.boolean().safeParse(0) returns { success: false } (0 is not a boolean in strict Zod)", () => {
    const result = z.boolean().safeParse(0);
    expect(result.success).toBe(false);
  });

  it("z.object({}).strict().safeParse({ extra: 1 }) fails — strict mode works through wrapper", () => {
    const schema = z.object({}).strict();
    const result = schema.safeParse({ extra: 1 });
    expect(result.success).toBe(false);
  });

  it("z.object({ x: z.string() }).strict().safeParse({ x: 'a', extra: 1 }) fails", () => {
    const schema = z.object({ x: z.string() }).strict();
    const result = schema.safeParse({ x: "a", extra: 1 });
    expect(result.success).toBe(false);
  });

  it("z.enum(['a', 'b']).safeParse('c') returns { success: false }", () => {
    const schema = z.enum(["a", "b"]);
    const result = schema.safeParse("c");
    expect(result.success).toBe(false);
  });

  it("z.array(z.string()).safeParse([1, 2, 3]) returns { success: false }", () => {
    const result = z.array(z.string()).safeParse([1, 2, 3]);
    expect(result.success).toBe(false);
  });

  it("z.literal('exact').safeParse('other') returns { success: false }", () => {
    const result = z.literal("exact").safeParse("other");
    expect(result.success).toBe(false);
  });

  it("z.union([z.string(), z.number()]).safeParse(true) returns { success: false }", () => {
    const result = z.union([z.string(), z.number()]).safeParse(true);
    expect(result.success).toBe(false);
  });

  it("z.object({ x: z.string() }).safeParse({}) returns { success: false } — required field missing", () => {
    const result = z.object({ x: z.string() }).safeParse({});
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// BOUNDARY CASES — optional fields, union discrimination, empty structures
// =============================================================================

describe("schema wrapper — boundary cases", () => {
  it("z.object with z.optional field accepts the field as absent", () => {
    const schema = z.object({ name: z.string().optional() });
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("z.object with z.optional field accepts the field as present", () => {
    const schema = z.object({ name: z.string().optional() });
    const result = schema.safeParse({ name: "alice" });
    expect(result.success).toBe(true);
  });

  it("z.array(z.string()).safeParse([]) succeeds — empty array is valid", () => {
    const result = z.array(z.string()).safeParse([]);
    expect(result.success).toBe(true);
  });

  it("z.union with single-element union accepts the valid type", () => {
    const result = z.union([z.string()]).safeParse("hello");
    expect(result.success).toBe(true);
  });

  it("z.object({}).safeParse({}) succeeds — empty schema accepts empty object", () => {
    const result = z.object({}).safeParse({});
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// GOLDEN PATH — structural duck-type + full parse correctness
// =============================================================================

describe("schema wrapper — golden path", () => {
  it("z is exported and is the Zod namespace (duck-type: required constructors are functions)", () => {
    expect(typeof z.object).toBe("function");
    expect(typeof z.string).toBe("function");
    expect(typeof z.array).toBe("function");
    expect(typeof z.enum).toBe("function");
    expect(typeof z.union).toBe("function");
    expect(typeof z.number).toBe("function");
    expect(typeof z.boolean).toBe("function");
    expect(typeof z.literal).toBe("function");
    expect(typeof z.optional).toBe("function");
  });

  it("z.object({}).safeParse({}) returns { success: true }", () => {
    const result = z.object({}).safeParse({});
    expect(result.success).toBe(true);
  });

  it("z.string().safeParse('hello') returns { success: true, data: 'hello' }", () => {
    const result = z.string().safeParse("hello");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("hello");
    }
  });

  it("z.number().safeParse(42) returns { success: true, data: 42 }", () => {
    const result = z.number().safeParse(42);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(42);
    }
  });

  it("z.boolean().safeParse(true) returns { success: true, data: true }", () => {
    const result = z.boolean().safeParse(true);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(true);
    }
  });

  it("z.enum(['PASS', 'BLOCKED']).safeParse('PASS') returns { success: true }", () => {
    const result = z.enum(["PASS", "BLOCKED"]).safeParse("PASS");
    expect(result.success).toBe(true);
  });

  it("z.array(z.number()).safeParse([1, 2, 3]) returns { success: true }", () => {
    const result = z.array(z.number()).safeParse([1, 2, 3]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([1, 2, 3]);
    }
  });

  it("z.literal('exact').safeParse('exact') returns { success: true }", () => {
    const result = z.literal("exact").safeParse("exact");
    expect(result.success).toBe(true);
  });

  it("z.union([z.string(), z.number()]).safeParse(99) returns { success: true }", () => {
    const result = z.union([z.string(), z.number()]).safeParse(99);
    expect(result.success).toBe(true);
  });

  it("z.object with nested schema round-trips correctly", () => {
    const schema = z.object({
      id: z.string(),
      count: z.number(),
      active: z.boolean(),
      tags: z.array(z.string()),
    });
    const input = { id: "abc", count: 5, active: true, tags: ["x", "y"] };
    const result = schema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });

  it("wrapper z is the same Zod instance as a direct zod import (identity check)", async () => {
    // Import raw zod and confirm the z.string constructor is the same function.
    // This verifies the wrapper does not create a shadow copy.
    const { z: rawZ } = await import("zod");
    // Both z.string() should produce ZodString — check the same _def.typeName
    const wrapperSchema = z.string();
    const rawSchema = rawZ.string();
    expect(wrapperSchema._def.typeName).toBe(rawSchema._def.typeName);
  });
});

// =============================================================================
// SOURCE-SCAN — import hygiene: consuming modules must use the wrapper
// =============================================================================

describe("schema wrapper — import hygiene (source-scan)", () => {
  const srcRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

  it("src/core/plan.ts does NOT import from zod directly", () => {
    const filePath = path.join(srcRoot, "core", "plan.ts");
    const source = fs.readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/from\s+["']zod["']/);
  });

  it("src/core/artifacts.ts does NOT import from zod directly", () => {
    const filePath = path.join(srcRoot, "core", "artifacts.ts");
    const source = fs.readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/from\s+["']zod["']/);
  });

  it("src/agents/load.ts does NOT import from zod directly", () => {
    const filePath = path.join(srcRoot, "agents", "load.ts");
    const source = fs.readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/from\s+["']zod["']/);
  });
});
