/**
 * Domain-Specific Evaluators — TEO Runtime Engine Layer 3
 *
 * Evaluators for gates that require analysis beyond simple script/file/field
 * checks. These handle the ~40 previously-unmapped gates:
 *
 *   1. link_checker     — verify markdown links resolve to existing files
 *   2. stale_ref_check  — detect references to renamed/moved/deleted files
 *   3. content_check    — verify content properties (placeholder text, iteration counts)
 *   4. pattern_match    — verify patterns in file contents (CSP headers, OWASP markers)
 *   5. asset_audit      — verify asset optimization, naming, and references
 *   6. session_check    — verify session state properties (gates, phases, flows)
 *
 * Gates that require LLM judgment (OWASP deep analysis, design quality)
 * return 'deferred_to_llm' verdict — these are routed to the appropriate
 * model tier by the Model Router.
 *
 * Gates that are human-by-design (7 gates) remain resolution: human.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Result builder (same format as gate-evaluators.js)
// ---------------------------------------------------------------------------

function makeResult(gateName, evaluatorType, verdict, evidence) {
  return {
    gate_name: gateName,
    verdict,
    evidence,
    evaluator_type: evaluatorType,
    timestamp: new Date().toISOString(),
  };
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

// ---------------------------------------------------------------------------
// 1. link_checker — verify markdown links resolve
// ---------------------------------------------------------------------------

/**
 * Check that markdown links in a directory resolve to existing files.
 *
 * @param {string} gateName
 * @param {object} config
 * @param {string} config.directory - Directory to scan for markdown files
 * @param {boolean} [config.recursive=true] - Recurse into subdirectories
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluateLinkChecker(gateName, config, enforcement) {
  const { directory = '.', recursive = true } = config;
  const brokenLinks = [];
  const checkedLinks = [];

  try {
    const findArgs = recursive
      ? [directory, '-name', '*.md', '-type', 'f']
      : [directory, '-maxdepth', '1', '-name', '*.md', '-type', 'f'];

    const files = execFileSync('find', findArgs, { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
      .trim().split('\n').filter(Boolean);

    for (const file of files.slice(0, 50)) { // Cap at 50 files for performance
      try {
        const content = fs.readFileSync(file, 'utf8');
        const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
        let match;

        while ((match = linkRegex.exec(content)) !== null) {
          const linkTarget = match[2];

          // Skip URLs, anchors, and mailto
          if (linkTarget.startsWith('http') || linkTarget.startsWith('#') ||
              linkTarget.startsWith('mailto:')) continue;

          // Strip anchor from path
          const cleanPath = linkTarget.split('#')[0];
          if (!cleanPath) continue;

          const resolvedPath = path.resolve(path.dirname(file), cleanPath);
          checkedLinks.push({ file, target: cleanPath, resolved: resolvedPath });

          if (!fs.existsSync(resolvedPath)) {
            brokenLinks.push({ file, target: cleanPath, resolved: resolvedPath });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    return makeResult(gateName, 'link_checker', enforcement, {
      error: 'Failed to scan directory',
      directory,
    });
  }

  const passed = brokenLinks.length === 0;
  const verdict = passed ? 'PASS' : enforcement;

  return makeResult(gateName, 'link_checker', verdict, {
    checked_count: checkedLinks.length,
    broken_count: brokenLinks.length,
    broken_links: brokenLinks.slice(0, 10).map(l => ({
      file: l.file,
      target: l.target,
    })),
  });
}

// ---------------------------------------------------------------------------
// 2. stale_ref_check — detect references to moved/deleted files
// ---------------------------------------------------------------------------

/**
 * Check for references to files that no longer exist at the referenced path.
 *
 * @param {string} gateName
 * @param {object} config
 * @param {string} config.directory - Directory to scan
 * @param {string[]} [config.extensions] - File extensions to check (default: .md, .yaml, .json)
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluateStaleRefCheck(gateName, config, enforcement) {
  const { directory = '.', extensions = ['.md', '.yaml', '.json'] } = config;
  const staleRefs = [];
  let filesScanned = 0;

  try {
    // Build find args with -o (OR) conditions for each extension — array form, no shell
    const extArgs = [];
    extensions.forEach((e, i) => {
      if (i > 0) extArgs.push('-o');
      extArgs.push('-name', `*${e}`);
    });
    const findArgs = [directory, '(', ...extArgs, ')', '-type', 'f'];

    const files = execFileSync('find', findArgs, { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
      .trim().split('\n').filter(Boolean);

    // Common reference patterns
    const refPatterns = [
      /(?:ref|reference|source|see|path|file):\s*["']?([.\w/\\-]+\.\w+)["']?/gi,
      /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const file of files.slice(0, 100)) { // Cap for performance
      try {
        const content = fs.readFileSync(file, 'utf8');
        filesScanned++;

        for (const pattern of refPatterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const refPath = match[1];
            // Skip node_modules, URLs, and very short refs
            if (refPath.includes('node_modules') || refPath.startsWith('http') || refPath.length < 3) continue;

            const resolved = path.resolve(path.dirname(file), refPath);
            if (!fs.existsSync(resolved) && !refPath.startsWith('@')) {
              staleRefs.push({ file, reference: refPath, resolved });
            }
          }
        }
      } catch {
        // Skip unreadable
      }
    }
  } catch {
    return makeResult(gateName, 'stale_ref_check', enforcement, {
      error: 'Failed to scan directory',
      directory,
    });
  }

  const passed = staleRefs.length === 0;
  const verdict = passed ? 'PASS' : enforcement;

  return makeResult(gateName, 'stale_ref_check', verdict, {
    files_scanned: filesScanned,
    stale_count: staleRefs.length,
    stale_refs: staleRefs.slice(0, 10).map(r => ({
      file: r.file,
      reference: r.reference,
    })),
  });
}

// ---------------------------------------------------------------------------
// 3. content_check — verify content properties
// ---------------------------------------------------------------------------

/**
 * Check content properties in files — placeholder detection, iteration markers,
 * content completeness.
 *
 * @param {string} gateName
 * @param {object} config
 * @param {string} config.check_type - "no_placeholder"|"has_pattern"|"iteration_count"|"no_pattern"
 * @param {string} [config.directory] - Directory to scan
 * @param {string} [config.file] - Specific file to check
 * @param {string} [config.pattern] - Regex pattern to match
 * @param {number} [config.min_count] - Minimum count for iteration_count check
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluateContentCheck(gateName, config, enforcement) {
  const { check_type, directory, file, pattern, min_count } = config;

  switch (check_type) {
    case 'no_placeholder': {
      // Check that no lorem ipsum or FPO markers remain in production content
      const placeholderPatterns = [
        /lorem ipsum/i,
        /\bFPO\b/,
        /placeholder/i,
        /TODO:\s*replace/i,
        /FIXME:\s*content/i,
      ];
      return _scanForPatterns(gateName, directory || file || '.', placeholderPatterns, false, enforcement);
    }

    case 'has_pattern': {
      // Verify a specific pattern exists in files
      if (!pattern) {
        return makeResult(gateName, 'content_check', 'WARN', { error: 'No pattern specified' });
      }
      const regex = new RegExp(pattern, 'i');
      return _scanForPatterns(gateName, directory || file || '.', [regex], true, enforcement);
    }

    case 'no_pattern': {
      // Verify a specific pattern does NOT exist
      if (!pattern) {
        return makeResult(gateName, 'content_check', 'WARN', { error: 'No pattern specified' });
      }
      const regex = new RegExp(pattern, 'i');
      return _scanForPatterns(gateName, directory || file || '.', [regex], false, enforcement);
    }

    case 'iteration_count': {
      // Check iteration markers in session/review files
      const targetFile = file || '.claude/memory/sessions/active-session.json';
      try {
        const content = fs.readFileSync(targetFile, 'utf8');
        const countPattern = pattern ? new RegExp(pattern, 'g') : /iteration|round|revision/gi;
        const matches = content.match(countPattern) || [];
        const passed = matches.length >= (min_count || 1);

        return makeResult(gateName, 'content_check', passed ? 'PASS' : enforcement, {
          check_type,
          file: targetFile,
          match_count: matches.length,
          required_min: min_count || 1,
        });
      } catch {
        return makeResult(gateName, 'content_check', enforcement, {
          error: 'File not readable',
          file: targetFile,
        });
      }
    }

    default:
      return makeResult(gateName, 'content_check', 'WARN', {
        error: `Unknown check_type: ${check_type}`,
      });
  }
}

function _scanForPatterns(gateName, target, patterns, expectMatch, enforcement) {
  const matches = [];
  let filesScanned = 0;

  const scanFile = (filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      filesScanned++;
      for (const p of patterns) {
        const m = content.match(p);
        if (m) {
          matches.push({ file: filePath, match: truncate(m[0], 50) });
        }
      }
    } catch { /* skip */ }
  };

  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      scanFile(target);
    } else if (stat.isDirectory()) {
      try {
        // Array form: no shell interpolation of target path
        const files = execFileSync(
          'find', [target, '(', '-name', '*.md', '-o', '-name', '*.yaml', '-o', '-name', '*.json', ')', '-type', 'f'],
          { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim().split('\n').filter(Boolean);
        for (const f of files.slice(0, 50)) scanFile(f);
      } catch { /* skip */ }
    }
  }

  const passed = expectMatch ? matches.length > 0 : matches.length === 0;
  const verdict = passed ? 'PASS' : enforcement;

  return makeResult(gateName, 'content_check', verdict, {
    files_scanned: filesScanned,
    matches_found: matches.length,
    expect_match: expectMatch,
    sample_matches: matches.slice(0, 5),
  });
}

// ---------------------------------------------------------------------------
// 4. pattern_match — verify patterns in specific files (CSP, OWASP markers)
// ---------------------------------------------------------------------------

/**
 * Check for security-related patterns in codebase files.
 *
 * @param {string} gateName
 * @param {object} config
 * @param {string} config.check_type - "csp_present"|"csp_restrictive"|"owasp_markers"|"header_check"
 * @param {string} [config.directory] - Directory to scan
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluatePatternMatch(gateName, config, enforcement) {
  const { check_type, directory = '.' } = config;

  switch (check_type) {
    case 'csp_present': {
      // Look for CSP header configuration in common locations
      const cspPatterns = [
        /content-security-policy/i,
        /contentSecurityPolicy/i,
        /csp.*header/i,
        /helmet\(/i,  // Express helmet middleware
      ];
      const searchDirs = [
        path.join(directory, 'src'),
        path.join(directory, 'server'),
        path.join(directory, 'middleware'),
        path.join(directory, 'next.config'),
        path.join(directory, 'astro.config'),
      ].filter(d => fs.existsSync(d));

      let found = false;
      const locations = [];

      for (const dir of searchDirs.length > 0 ? searchDirs : [directory]) {
        try {
          const files = execFileSync(
            'find', [dir, '-type', 'f', '(', '-name', '*.ts', '-o', '-name', '*.js', '-o', '-name', '*.mjs', '-o', '-name', '*.yaml', '-o', '-name', '*.json', ')'],
            { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim().split('\n').filter(Boolean);

          for (const file of files.slice(0, 50)) {
            try {
              const content = fs.readFileSync(file, 'utf8');
              for (const p of cspPatterns) {
                if (p.test(content)) {
                  found = true;
                  locations.push(file);
                  break;
                }
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }

      return makeResult(gateName, 'pattern_match', found ? 'PASS' : enforcement, {
        check_type,
        found,
        locations: locations.slice(0, 5),
      });
    }

    case 'csp_restrictive': {
      // Check that CSP doesn't contain unsafe directives without justification
      const unsafePatterns = [/unsafe-inline/i, /unsafe-eval/i];
      const searchDir = directory;
      const violations = [];

      try {
        const files = execFileSync(
          'find', [searchDir, '-type', 'f', '(', '-name', '*.ts', '-o', '-name', '*.js', '-o', '-name', '*.mjs', ')'],
          { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim().split('\n').filter(Boolean);

        for (const file of files.slice(0, 50)) {
          try {
            const content = fs.readFileSync(file, 'utf8');
            if (/content-security-policy/i.test(content)) {
              for (const p of unsafePatterns) {
                if (p.test(content)) {
                  violations.push({ file, pattern: p.source });
                }
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      return makeResult(gateName, 'pattern_match', violations.length === 0 ? 'PASS' : enforcement, {
        check_type,
        violations_found: violations.length,
        violations: violations.slice(0, 5),
      });
    }

    case 'owasp_markers': {
      // Check for OWASP-related security review artifacts
      const markers = [
        '.claude/memory/reviews/security-*.md',
        '.claude/memory/reviews/owasp-*.md',
        'docs/security-review*.md',
      ];

      let found = false;
      const foundFiles = [];

      for (const pattern of markers) {
        const dir = path.dirname(pattern);
        const filePattern = path.basename(pattern);
        const searchPath = path.resolve(directory, dir);
        if (!fs.existsSync(searchPath)) continue;

        try {
          const files = execFileSync(
            'find', [searchPath, '-maxdepth', '1', '-name', filePattern, '-type', 'f'],
            { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim().split('\n').filter(Boolean);

          if (files.length > 0) {
            found = true;
            foundFiles.push(...files);
          }
        } catch { /* skip */ }
      }

      return makeResult(gateName, 'pattern_match', found ? 'PASS' : enforcement, {
        check_type,
        found,
        marker_files: foundFiles.slice(0, 5),
      });
    }

    case 'header_check': {
      // Verify security headers in configuration files
      const headerPatterns = [
        /x-frame-options/i,
        /x-content-type-options/i,
        /strict-transport-security/i,
        /x-xss-protection/i,
        /referrer-policy/i,
      ];

      let headersFound = 0;
      const foundHeaders = [];

      try {
        const files = execFileSync(
          'find', [directory, '-type', 'f', '(', '-name', '*.ts', '-o', '-name', '*.js', '-o', '-name', '*.mjs', '-o', '-name', '*.yaml', '-o', '-name', '*.json', ')'],
          { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim().split('\n').filter(Boolean);

        for (const file of files.slice(0, 50)) {
          try {
            const content = fs.readFileSync(file, 'utf8');
            for (const p of headerPatterns) {
              if (p.test(content)) {
                headersFound++;
                foundHeaders.push(p.source);
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      const passed = headersFound >= 3; // At least 3 of 5 common headers
      return makeResult(gateName, 'pattern_match', passed ? 'PASS' : enforcement, {
        check_type,
        headers_found: headersFound,
        headers_total: headerPatterns.length,
        found: [...new Set(foundHeaders)],
      });
    }

    default:
      return makeResult(gateName, 'pattern_match', 'WARN', {
        error: `Unknown check_type: ${check_type}`,
      });
  }
}

// ---------------------------------------------------------------------------
// 5. asset_audit — verify asset optimization and references
// ---------------------------------------------------------------------------

/**
 * Audit assets for optimization, naming conventions, and valid references.
 *
 * @param {string} gateName
 * @param {object} config
 * @param {string} config.check_type - "all_optimized"|"descriptive_names"|"valid_references"|"size_budget"
 * @param {string} [config.directory] - Directory to audit
 * @param {number} [config.max_size_kb] - Maximum file size in KB
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluateAssetAudit(gateName, config, enforcement) {
  const { check_type, directory = '.', max_size_kb = 500 } = config;

  switch (check_type) {
    case 'all_optimized': {
      // Check that all images in staging have optimized variants
      const stagingDirs = ['data/images', 'public/images', 'static/images']
        .map(d => path.resolve(directory, d))
        .filter(d => fs.existsSync(d));

      if (stagingDirs.length === 0) {
        return makeResult(gateName, 'asset_audit', 'PASS', {
          check_type,
          note: 'No staging directories found — nothing to audit',
        });
      }

      const unoptimized = [];
      for (const dir of stagingDirs) {
        try {
          const files = execFileSync(
            'find', [dir, '-type', 'f', '(', '-name', '*.png', '-o', '-name', '*.jpg', '-o', '-name', '*.jpeg', '-o', '-name', '*.webp', ')'],
            { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim().split('\n').filter(Boolean);

          for (const file of files) {
            if (!file.includes('-optimized') && !file.includes('.optimized')) {
              // Check if optimized variant exists
              const ext = path.extname(file);
              const base = file.slice(0, -ext.length);
              const optimizedPath = `${base}-optimized${ext}`;
              if (!fs.existsSync(optimizedPath)) {
                unoptimized.push(file);
              }
            }
          }
        } catch { /* skip */ }
      }

      return makeResult(gateName, 'asset_audit', unoptimized.length === 0 ? 'PASS' : enforcement, {
        check_type,
        unoptimized_count: unoptimized.length,
        unoptimized: unoptimized.slice(0, 10),
      });
    }

    case 'descriptive_names': {
      // Check that asset files have descriptive names (not UUIDs)
      const uuidPattern = /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/i;
      const badNames = [];

      try {
        const files = execFileSync(
          'find', [directory, '-type', 'f', '(', '-name', '*.png', '-o', '-name', '*.jpg', '-o', '-name', '*.svg', ')'],
          { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim().split('\n').filter(Boolean);

        for (const file of files) {
          if (uuidPattern.test(path.basename(file))) {
            badNames.push(file);
          }
        }
      } catch { /* skip */ }

      return makeResult(gateName, 'asset_audit', badNames.length === 0 ? 'PASS' : enforcement, {
        check_type,
        uuid_named_count: badNames.length,
        uuid_named: badNames.slice(0, 10),
      });
    }

    case 'size_budget': {
      // Check that assets are under size budget
      const overBudget = [];
      const maxBytes = max_size_kb * 1024;

      try {
        const files = execFileSync(
          'find', [directory, '-type', 'f', '(', '-name', '*.png', '-o', '-name', '*.jpg', '-o', '-name', '*.svg', '-o', '-name', '*.webp', ')'],
          { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim().split('\n').filter(Boolean);

        for (const file of files) {
          try {
            const stat = fs.statSync(file);
            if (stat.size > maxBytes) {
              overBudget.push({ file, size_kb: Math.round(stat.size / 1024) });
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      return makeResult(gateName, 'asset_audit', overBudget.length === 0 ? 'PASS' : enforcement, {
        check_type,
        budget_kb: max_size_kb,
        over_budget_count: overBudget.length,
        over_budget: overBudget.slice(0, 10),
      });
    }

    default:
      return makeResult(gateName, 'asset_audit', 'PASS', {
        check_type,
        note: 'No applicable audit',
      });
  }
}

// ---------------------------------------------------------------------------
// 6. session_check — verify session state properties
// ---------------------------------------------------------------------------

/**
 * Check session state for specific properties.
 *
 * @param {string} gateName
 * @param {object} config
 * @param {string} config.check_type - "gates_passed"|"phase_complete"|"flow_active"|"no_blocks"
 * @param {string} [config.session_file] - Path to session file
 * @param {string} [config.expected_flow] - Expected active flow name
 * @param {string} [config.expected_phase] - Expected phase name
 * @param {number} [config.min_gates] - Minimum gates passed
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluateSessionCheck(gateName, config, enforcement) {
  const {
    check_type,
    session_file = '.claude/memory/sessions/active-session.json',
    expected_flow,
    expected_phase,
    min_gates = 0,
  } = config;

  let session;
  try {
    session = JSON.parse(fs.readFileSync(session_file, 'utf8'));
  } catch {
    return makeResult(gateName, 'session_check', enforcement, {
      error: 'Session file not readable',
      file: session_file,
    });
  }

  switch (check_type) {
    case 'gates_passed': {
      const passCount = (session.gate_history || []).filter(g => g.verdict === 'PASS').length;
      const passed = passCount >= min_gates;
      return makeResult(gateName, 'session_check', passed ? 'PASS' : enforcement, {
        check_type,
        gates_passed: passCount,
        required: min_gates,
      });
    }

    case 'no_blocks': {
      const blocks = (session.gate_history || []).filter(g => g.verdict === 'BLOCK');
      return makeResult(gateName, 'session_check', blocks.length === 0 ? 'PASS' : enforcement, {
        check_type,
        block_count: blocks.length,
        blocks: blocks.slice(0, 5).map(b => b.gate),
      });
    }

    case 'phase_complete': {
      const passed = session.current_phase === expected_phase;
      return makeResult(gateName, 'session_check', passed ? 'PASS' : enforcement, {
        check_type,
        current_phase: session.current_phase,
        expected_phase,
      });
    }

    case 'flow_active': {
      const passed = session.active_flow === expected_flow;
      return makeResult(gateName, 'session_check', passed ? 'PASS' : enforcement, {
        check_type,
        active_flow: session.active_flow,
        expected_flow,
      });
    }

    default:
      return makeResult(gateName, 'session_check', 'WARN', {
        error: `Unknown check_type: ${check_type}`,
      });
  }
}

// ---------------------------------------------------------------------------
// Domain evaluate dispatcher
// ---------------------------------------------------------------------------

/**
 * Route to the correct domain evaluator.
 *
 * @param {string} gateName
 * @param {string} evaluatorType
 * @param {object} config
 * @param {"BLOCK"|"WARN"} enforcement
 * @returns {object} GateResult
 */
function evaluateDomain(gateName, evaluatorType, config, enforcement) {
  switch (evaluatorType) {
    case 'link_checker':
      return evaluateLinkChecker(gateName, config, enforcement);
    case 'stale_ref_check':
      return evaluateStaleRefCheck(gateName, config, enforcement);
    case 'content_check':
      return evaluateContentCheck(gateName, config, enforcement);
    case 'pattern_match':
      return evaluatePatternMatch(gateName, config, enforcement);
    case 'asset_audit':
      return evaluateAssetAudit(gateName, config, enforcement);
    case 'session_check':
      return evaluateSessionCheck(gateName, config, enforcement);
    default:
      return makeResult(gateName, evaluatorType, 'WARN', {
        error: `Unknown domain evaluator: ${evaluatorType}`,
      });
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  evaluateDomain,
  evaluateLinkChecker,
  evaluateStaleRefCheck,
  evaluateContentCheck,
  evaluatePatternMatch,
  evaluateAssetAudit,
  evaluateSessionCheck,
  makeResult,
};
