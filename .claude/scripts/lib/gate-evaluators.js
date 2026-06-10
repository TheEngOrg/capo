/**
 * Gate Evaluator Library — TEO Runtime Engine Layer 1
 *
 * Four evaluator types that mechanically check gate conditions:
 *   1. script_exit  — run a command, check exit code
 *   2. file_exists  — check file/directory existence (glob supported)
 *   3. field_check  — check field presence/value in structured files
 *   4. count_match  — compare counted values
 *
 * Each evaluator returns a GateResult:
 *   { gate_name, verdict, evidence, evaluator_type, timestamp }
 *
 * See: .claude/shared/gate-evaluator-protocol.md
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

function makeResult(gateName, evaluatorType, verdict, evidence) {
  return {
    gate_name: gateName,
    verdict,          // "PASS" | "WARN" | "BLOCK"
    evidence,         // string or object
    evaluator_type: evaluatorType,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 1. script_exit — run command, check exit code
// ---------------------------------------------------------------------------

/**
 * @param {string} gateName
 * @param {object} config
 * @param {string} config.command
 * @param {number} [config.expected_exit=0]
 * @param {number} [config.timeout_ms=30000]
 * @param {string} [config.working_dir='.']
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluateScriptExit(gateName, config, enforcement) {
  const {
    command,
    expected_exit = 0,
    timeout_ms = 30000,
    working_dir = '.',
  } = config;

  let exitCode = -1;
  let stdout = '';
  let stderr = '';

  try {
    const result = execFileSync('/bin/sh', ['-c', command], {
      cwd: working_dir,
      timeout: timeout_ms,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    exitCode = 0;
    stdout = typeof result === 'string' ? result : '';
  } catch (err) {
    exitCode = err.status != null ? err.status : 1;
    stdout = err.stdout || '';
    stderr = err.stderr || '';
  }

  const passed = exitCode === expected_exit;
  const verdict = passed ? 'PASS' : enforcement;

  const evidence = {
    command,
    exit_code: exitCode,
    expected: expected_exit,
    stdout_summary: truncate(stdout, 200),
    stderr_summary: truncate(stderr, 200),
  };

  return makeResult(gateName, 'script_exit', verdict, evidence);
}

// ---------------------------------------------------------------------------
// 2. file_exists — check file or glob pattern existence
// ---------------------------------------------------------------------------

/**
 * @param {string} gateName
 * @param {object} config
 * @param {string} config.path - exact path or simple glob (supports * only)
 * @param {"any"|"all"} [config.match="any"]
 * @param {string} [config.base_dir="."]
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluateFileExists(gateName, config, enforcement) {
  const {
    path: pattern,
    match = 'any',
    base_dir = '.',
  } = config;

  let matchedFiles = [];

  if (pattern.includes('*')) {
    // Simple glob using find
    try {
      const dir = path.dirname(pattern);
      const filePattern = path.basename(pattern);
      const searchDir = path.resolve(base_dir, dir);
      // Use execFileSync with array args to bypass shell — no string interpolation
      const result = execFileSync(
        'find', [searchDir, '-maxdepth', '1', '-name', filePattern, '-type', 'f'],
        { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      matchedFiles = result.trim().split('\n').filter(Boolean);
    } catch {
      matchedFiles = [];
    }
  } else {
    const fullPath = path.resolve(base_dir, pattern);
    if (fs.existsSync(fullPath)) {
      matchedFiles = [fullPath];
    }
  }

  const passed = match === 'any'
    ? matchedFiles.length > 0
    : matchedFiles.length > 0; // "all" mode would need an expected list

  const verdict = passed ? 'PASS' : enforcement;

  const evidence = {
    pattern,
    matched_files: matchedFiles.slice(0, 10),
    match_count: matchedFiles.length,
    match_mode: match,
  };

  return makeResult(gateName, 'file_exists', verdict, evidence);
}

// ---------------------------------------------------------------------------
// 3. field_check — check field in structured file
// ---------------------------------------------------------------------------

/**
 * @param {string} gateName
 * @param {object} config
 * @param {string} config.file
 * @param {"json"|"yaml_frontmatter"|"text_pattern"} config.format
 * @param {string} config.field
 * @param {"present"|"equals"|"contains"} [config.expected="present"]
 * @param {*} [config.value]
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluateFieldCheck(gateName, config, enforcement) {
  const {
    file: filePath,
    format,
    field,
    expected = 'present',
    value = null,
  } = config;

  let found = false;
  let actualValue = null;

  try {
    const content = fs.readFileSync(filePath, 'utf8');

    switch (format) {
      case 'json': {
        const obj = JSON.parse(content);
        actualValue = getNestedField(obj, field);
        found = actualValue !== undefined;
        break;
      }

      case 'yaml_frontmatter': {
        // Extract YAML between --- delimiters
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          // Simple key-value extraction (no full YAML parser needed for frontmatter)
          const fmContent = fmMatch[1];
          const lines = fmContent.split('\n');
          for (const line of lines) {
            const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
            if (kvMatch && kvMatch[1] === field) {
              actualValue = kvMatch[2].trim().replace(/^["']|["']$/g, '');
              found = true;
              break;
            }
          }
        }
        break;
      }

      case 'text_pattern': {
        const regex = new RegExp(field);
        const m = content.match(regex);
        found = !!m;
        actualValue = m ? m[0] : null;
        break;
      }

      default:
        break;
    }
  } catch {
    found = false;
  }

  let passed = false;
  switch (expected) {
    case 'present':
      passed = found;
      break;
    case 'equals':
      passed = found && String(actualValue) === String(value);
      break;
    case 'contains':
      passed = found && String(actualValue).includes(String(value));
      break;
  }

  const verdict = passed ? 'PASS' : enforcement;

  const evidence = {
    file: filePath,
    format,
    field,
    expected,
    found,
    actual_value: actualValue != null ? truncate(String(actualValue), 100) : null,
  };

  return makeResult(gateName, 'field_check', verdict, evidence);
}

// ---------------------------------------------------------------------------
// 4. count_match — compare counted values
// ---------------------------------------------------------------------------

/**
 * @param {string} gateName
 * @param {object} config
 * @param {"glob"|"json_field"|"command"} config.source
 * @param {object} config.source_config
 * @param {"equals"|"gte"|"lte"|"gt"|"lt"} config.compare
 * @param {number} [config.expected] - static expected value
 * @param {object} [config.expected_config] - dynamic expected source
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluateCountMatch(gateName, config, enforcement) {
  const {
    source,
    source_config = {},
    compare,
    expected: staticExpected,
    expected_source,
    expected_config = {},
  } = config;

  let actual = 0;
  let expectedVal = staticExpected;

  // Count from source
  switch (source) {
    case 'glob': {
      try {
        // Use execFileSync with array args to bypass shell — count lines in JS
        const result = execFileSync(
          'find', ['.', '-path', source_config.pattern, '-type', 'f'],
          { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        actual = result.trim().split('\n').filter(Boolean).length;
      } catch {
        actual = 0;
      }
      break;
    }
    case 'json_field': {
      try {
        const content = fs.readFileSync(source_config.file, 'utf8');
        const obj = JSON.parse(content);
        actual = Number(getNestedField(obj, source_config.field)) || 0;
      } catch {
        actual = 0;
      }
      break;
    }
    case 'command': {
      try {
        // Pass command as data arg to /bin/sh — command is not interpolated into shell string
        const result = execFileSync('/bin/sh', ['-c', source_config.command], {
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        actual = parseInt(result.trim(), 10) || 0;
      } catch {
        actual = 0;
      }
      break;
    }
  }

  // Dynamic expected value
  if (expected_source === 'field' && expected_config.file) {
    try {
      const content = fs.readFileSync(expected_config.file, 'utf8');
      const regex = new RegExp(expected_config.pattern);
      const m = content.match(regex);
      if (m && m[expected_config.group || 1]) {
        expectedVal = parseInt(m[expected_config.group || 1], 10);
      }
    } catch {
      // keep static expected
    }
  }

  let passed = false;
  switch (compare) {
    case 'equals': passed = actual === expectedVal; break;
    case 'gte':    passed = actual >= expectedVal; break;
    case 'lte':    passed = actual <= expectedVal; break;
    case 'gt':     passed = actual > expectedVal; break;
    case 'lt':     passed = actual < expectedVal; break;
  }

  const verdict = passed ? 'PASS' : enforcement;

  const evidence = {
    source,
    actual,
    expected: expectedVal,
    compare,
    passed,
  };

  return makeResult(gateName, 'count_match', verdict, evidence);
}

// ---------------------------------------------------------------------------
// Evaluate dispatcher — routes to the correct evaluator type
// ---------------------------------------------------------------------------

/**
 * @param {string} gateName
 * @param {string} evaluatorType - "script_exit" | "file_exists" | "field_check" | "count_match"
 * @param {object} config - evaluator-specific config
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluate(gateName, evaluatorType, config, enforcement) {
  switch (evaluatorType) {
    case 'script_exit':
      return evaluateScriptExit(gateName, config, enforcement);
    case 'file_exists':
      return evaluateFileExists(gateName, config, enforcement);
    case 'field_check':
      return evaluateFieldCheck(gateName, config, enforcement);
    case 'count_match':
      return evaluateCountMatch(gateName, config, enforcement);
    default:
      return makeResult(
        gateName,
        evaluatorType,
        'WARN',
        { error: `Unknown evaluator type: ${evaluatorType}` }
      );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

function getNestedField(obj, dotPath) {
  const parts = dotPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  evaluate,
  evaluateScriptExit,
  evaluateFileExists,
  evaluateFieldCheck,
  evaluateCountMatch,
  makeResult,
};
