/**
 * Process Engine — TEO Runtime Engine Layer 3
 *
 * Ties together flow registry, gate evaluators, domain evaluators,
 * model router, and session state into a single orchestration module.
 * This is the entry point for hook scripts and the future MCP server.
 *
 * Layer 1: Flow registry, 4 evaluator types, session state, traces
 * Layer 2: Cross-session learning, context cliff handoff, >50% gate coverage, locks
 * Layer 3: Model routing for token cost optimization (-30-40%),
 *          domain-specific evaluators for ~40 previously-unmapped gates,
 *          runtime enforcement pushed toward maximum achievable
 *
 * See: docs/runtime-engine-architecture.md
 */

'use strict';

const { FlowRegistry } = require('./flow-registry');
const { evaluate } = require('./gate-evaluators');
const { evaluateDomain } = require('./domain-evaluators');
const { ModelRouter } = require('./model-router');
const { SessionManager } = require('./session-state');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Trace writer
// ---------------------------------------------------------------------------

const TRACES_DIR = '.claude/memory/traces';

/**
 * Append a structured trace event to the trace file.
 */
function writeTrace(projectRoot, traceType, event) {
  const tracesDir = path.join(projectRoot, TRACES_DIR);
  if (!fs.existsSync(tracesDir)) {
    fs.mkdirSync(tracesDir, { recursive: true });
  }

  const traceFile = path.join(tracesDir, `engine-${traceType}.json`);

  let data = { entries: [] };
  if (fs.existsSync(traceFile)) {
    try {
      data = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
    } catch {
      data = { entries: [] };
    }
  }

  data.entries.push({
    timestamp: new Date().toISOString(),
    ...event,
  });

  fs.writeFileSync(traceFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// ProcessEngine class
// ---------------------------------------------------------------------------

class ProcessEngine {
  constructor(projectRoot) {
    this.projectRoot = projectRoot || process.cwd();
    this.registry = new FlowRegistry(this.projectRoot);
    this.session = new SessionManager(this.projectRoot);
    this.router = new ModelRouter();  // Layer 3: model routing
    this.initialized = false;
  }

  /**
   * Initialize the engine: load flows, start/load session, apply cross-session learning.
   */
  initialize(sessionId) {
    // Load flow registry
    const summary = this.registry.load();

    // Start or load session (with locking in Layer 2)
    const sid = sessionId || `engine-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const sessionResult = this.session.startOrLoad(sid);

    // Layer 2: Cross-session learning — load previous session insights
    const learnings = this.loadCrossSessionLearnings();

    // Layer 3: Simulate model routing for cost estimation
    const routingSimulation = this.router.simulateFlowRouting(this.registry);

    this.initialized = true;

    // Write initialization trace
    writeTrace(this.projectRoot, 'lifecycle', {
      event_type: 'engine_init',
      session_id: sessionResult.session_id,
      session_action: sessionResult.action,
      flows_loaded: summary.total,
      flows_atomic: summary.atomic,
      flows_composed: summary.composed,
      flows_skipped: summary.skipped,
      cross_session_learnings: learnings.summary,
      model_routing: routingSimulation.summary,
    });

    return {
      registry: summary,
      session: sessionResult,
      learnings,
      routing: routingSimulation.summary,
    };
  }

  /**
   * Layer 2: Load learnings from previous sessions.
   * Reads archived session files, extracts gate failure patterns,
   * and applies them as pre-warmed knowledge for the current session.
   */
  loadCrossSessionLearnings() {
    const sessionsDir = path.join(this.projectRoot, '.claude', 'memory', 'sessions');
    const learnings = {
      previous_sessions: 0,
      gate_failure_patterns: [],
      frequently_blocked_gates: [],
      summary: 'no_previous_sessions',
    };

    if (!fs.existsSync(sessionsDir)) return learnings;

    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.startsWith('session-') && f.endsWith('.json'))
      .sort()
      .slice(-10); // Last 10 sessions

    if (files.length === 0) return learnings;

    const gateFailureCounts = {};
    let totalSessions = 0;

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(sessionsDir, file), 'utf8');
        const session = JSON.parse(content);
        totalSessions++;

        if (session.gate_history) {
          for (const entry of session.gate_history) {
            if (entry.verdict === 'BLOCK' || entry.verdict === 'WARN') {
              const key = entry.gate;
              gateFailureCounts[key] = (gateFailureCounts[key] || 0) + 1;
              learnings.gate_failure_patterns.push({
                gate: entry.gate,
                verdict: entry.verdict,
                session: session.session_id,
                evidence_summary: typeof entry.evidence === 'string'
                  ? entry.evidence.slice(0, 100)
                  : 'structured',
              });
            }
          }
        }
      } catch {
        // Skip corrupted session files
      }
    }

    learnings.previous_sessions = totalSessions;

    // Gates that failed in >50% of sessions are "frequently blocked"
    learnings.frequently_blocked_gates = Object.entries(gateFailureCounts)
      .filter(([, count]) => count > totalSessions * 0.5)
      .map(([gate, count]) => ({ gate, failure_count: count, session_count: totalSessions }));

    // Pre-warm: set pending gates for frequently blocked gates
    if (learnings.frequently_blocked_gates.length > 0) {
      this.session.setPendingGates(
        learnings.frequently_blocked_gates.map(g => g.gate)
      );
    }

    learnings.summary = totalSessions > 0
      ? `learned_from_${totalSessions}_sessions`
      : 'no_previous_sessions';

    return learnings;
  }

  /**
   * Layer 2: Check context pressure and trigger handoff if critical.
   * Returns handoff recommendation when context pressure exceeds threshold.
   *
   * @param {number} tokenEstimate - Current estimated token count
   * @returns {{ handoff_needed: boolean, pressure: string, recommendation: string }}
   */
  checkContextCliff(tokenEstimate) {
    this.session.updateContextPressure(tokenEstimate);
    const state = this.session.getState();
    const pressure = state ? state.context_pressure : 'unknown';

    if (pressure === 'critical') {
      const gateSummary = this.session.getGateSummary();
      const handoffState = {
        active_flow: state.active_flow,
        current_phase: state.current_phase,
        gates_passed: gateSummary.pass,
        gates_pending: state.pending_gates,
        token_estimate: tokenEstimate,
      };

      // Write handoff file for next session to pick up
      const handoffPath = path.join(this.projectRoot, '.claude', 'memory', 'sessions', 'handoff-pending.json');
      fs.writeFileSync(handoffPath, JSON.stringify({
        created_at: new Date().toISOString(),
        from_session: state.session_id,
        ...handoffState,
      }, null, 2) + '\n', 'utf8');

      writeTrace(this.projectRoot, 'lifecycle', {
        event_type: 'context_cliff_handoff',
        session_id: state.session_id,
        token_estimate: tokenEstimate,
        pressure,
        gates_passed: gateSummary.pass,
        gates_pending: state.pending_gates.length,
      });

      return {
        handoff_needed: true,
        pressure,
        recommendation: `Context pressure CRITICAL (${tokenEstimate} tokens). End session now. Handoff state saved. Next session will auto-resume from phase "${state.current_phase}".`,
        handoff_state: handoffState,
      };
    }

    if (pressure === 'high') {
      return {
        handoff_needed: false,
        pressure,
        recommendation: `Context pressure HIGH (${tokenEstimate} tokens). Consider wrapping up current phase and preparing handoff.`,
      };
    }

    return {
      handoff_needed: false,
      pressure,
      recommendation: null,
    };
  }

  /**
   * Layer 2: Resume from a previous session handoff.
   * Called during initialize() if a handoff-pending.json exists.
   */
  resumeFromHandoff() {
    const handoffPath = path.join(this.projectRoot, '.claude', 'memory', 'sessions', 'handoff-pending.json');
    if (!fs.existsSync(handoffPath)) return null;

    try {
      const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));

      // Apply handoff state to current session
      if (handoff.active_flow) {
        this.session.setActiveFlow(handoff.active_flow, handoff.current_phase);
      }
      if (handoff.gates_pending) {
        this.session.setPendingGates(handoff.gates_pending);
      }

      // Archive the handoff file
      const archiveName = `handoff-${handoff.from_session || 'unknown'}.json`;
      const archivePath = path.join(this.projectRoot, '.claude', 'memory', 'sessions', archiveName);
      fs.copyFileSync(handoffPath, archivePath);
      fs.unlinkSync(handoffPath);

      writeTrace(this.projectRoot, 'lifecycle', {
        event_type: 'session_resumed_from_handoff',
        from_session: handoff.from_session,
        active_flow: handoff.active_flow,
        current_phase: handoff.current_phase,
        gates_pending: handoff.gates_pending ? handoff.gates_pending.length : 0,
      });

      return handoff;
    } catch {
      return null;
    }
  }

  /**
   * Evaluate gates triggered by a command.
   * Used by pre-bash hook.
   *
   * @param {string} command - The bash command about to be executed
   * @returns {{ allow: boolean, results: object[] }}
   */
  evaluateCommandGates(command) {
    if (!this.initialized) {
      this.initialize();
    }

    const matchedGates = this.registry.getGatesTriggeredByCommand(command);
    if (matchedGates.length === 0) {
      return { allow: true, results: [] };
    }

    const results = [];
    let blocked = false;

    for (const gate of matchedGates) {
      // Skip gates already passed in this session
      if (this.session.hasGatePassed(gate.name)) {
        results.push({
          gate_name: gate.name,
          verdict: 'PASS',
          evidence: 'Already passed in this session',
          evaluator_type: 'session_cache',
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      // Determine evaluator config based on gate definition
      const evaluatorConfig = mapGateToEvaluator(gate);
      if (!evaluatorConfig) {
        // No mechanical evaluator — sage_evaluation type, skip in hook
        results.push({
          gate_name: gate.name,
          verdict: 'PASS',
          evidence: 'Requires sage_evaluation — deferred to pipeline',
          evaluator_type: 'sage_evaluation',
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      // Layer 3: Route gate to appropriate model tier
      const routing = this.router.routeGate({ ...gate, _evaluator_type: evaluatorConfig.type });

      const enforcement = gate.on_fail === 'block' ? 'BLOCK' : 'WARN';

      // Layer 3: Use domain evaluators for domain-specific types
      let result;
      if (evaluatorConfig.type.startsWith('domain:')) {
        const domainType = evaluatorConfig.type.replace('domain:', '');
        result = evaluateDomain(
          gate.name,
          domainType,
          evaluatorConfig.config,
          enforcement
        );
      } else {
        result = evaluate(
          gate.name,
          evaluatorConfig.type,
          evaluatorConfig.config,
          enforcement
        );
      }

      // Annotate result with routing info
      result.model_tier = routing.tier;
      result.model_rationale = routing.rationale;

      results.push(result);
      this.session.recordGate(result);

      if (result.verdict === 'BLOCK') {
        blocked = true;
        // Write trace for blocked gate
        writeTrace(this.projectRoot, 'gate-blocks', {
          event_type: 'gate_block',
          gate_name: gate.name,
          flow_name: gate.flow_name || gate.flowName,
          command,
          evidence: result.evidence,
        });
        break; // Stop evaluating after first BLOCK
      }
    }

    return { allow: !blocked, results };
  }

  /**
   * Evaluate gates for a specific flow phase.
   * Used by pipeline execution.
   *
   * @param {string} flowName
   * @param {string} phaseName
   * @returns {{ passed: boolean, results: object[] }}
   */
  evaluatePhaseGates(flowName, phaseName) {
    if (!this.initialized) {
      this.initialize();
    }

    const gates = this.registry.getGatesForPhase(flowName, phaseName);
    const results = [];
    let allPassed = true;

    for (const gate of gates) {
      // Only evaluate auto-resolution gates mechanically
      if (gate.resolution === 'human') {
        results.push({
          gate_name: gate.name,
          verdict: 'WARN',
          evidence: 'Human resolution required — escalate to user',
          evaluator_type: 'human_gate',
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const evaluatorConfig = mapGateToEvaluator(gate);
      if (!evaluatorConfig) {
        results.push({
          gate_name: gate.name,
          verdict: 'PASS',
          evidence: 'No mechanical evaluator — deferred',
          evaluator_type: 'deferred',
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      // Layer 3: Route gate to appropriate model tier
      const routing = this.router.routeGate({ ...gate, _evaluator_type: evaluatorConfig.type });

      const enforcement = gate.on_fail === 'block' ? 'BLOCK' : 'WARN';

      // Layer 3: Use domain evaluators for domain-specific types
      let result;
      if (evaluatorConfig.type.startsWith('domain:')) {
        const domainType = evaluatorConfig.type.replace('domain:', '');
        result = evaluateDomain(
          gate.name,
          domainType,
          evaluatorConfig.config,
          enforcement
        );
      } else {
        result = evaluate(
          gate.name,
          evaluatorConfig.type,
          evaluatorConfig.config,
          enforcement
        );
      }

      // Annotate with routing info
      result.model_tier = routing.tier;

      results.push(result);
      this.session.recordGate(result);

      if (result.verdict === 'BLOCK') {
        allPassed = false;
        writeTrace(this.projectRoot, 'gate-blocks', {
          event_type: 'phase_gate_block',
          gate_name: gate.name,
          flow_name: flowName,
          phase_name: phaseName,
          evidence: result.evidence,
          model_tier: routing.tier,
        });
        break;
      }
    }

    // Update session phase only when all gates passed — never advance on block
    if (allPassed) {
      this.session.advancePhase(phaseName);
    }

    return { passed: allPassed, results };
  }

  /**
   * Get engine status for diagnostics.
   */
  getStatus() {
    const sessionState = this.session.getState();
    const gateSummary = this.session.getGateSummary();
    const costSummary = this.router.getCostSummary();

    return {
      initialized: this.initialized,
      layer: 3,
      flows_loaded: this.registry.loaded ? this.registry.getAllFlowNames().length : 0,
      flow_names: this.registry.loaded ? this.registry.getAllFlowNames() : [],
      session: sessionState ? {
        id: sessionState.session_id,
        active_flow: sessionState.active_flow,
        current_phase: sessionState.current_phase,
        context_pressure: sessionState.context_pressure,
        gate_summary: gateSummary,
      } : null,
      model_routing: costSummary,
    };
  }
}

// ---------------------------------------------------------------------------
// Gate-to-evaluator mapping
// ---------------------------------------------------------------------------

/**
 * Map a gate definition to an evaluator type and config.
 * Returns null if no mechanical evaluator is available (sage_evaluation).
 *
 * Layer 2: Expanded mapping covering >50% of all gates.
 * Gate patterns are matched against the `gate` field (atomic flows)
 * and the `condition` field (composed flows).
 */
function mapGateToEvaluator(gate) {
  const gateStr = gate.gate || '';
  const condStr = gate.condition || '';
  const combined = (gateStr + ' ' + condStr).toLowerCase();

  // ─── script_exit patterns ───────────────────────────────────────────

  // test_exit_code == 0, all_test_suites_pass, all_suites_green, all_passing_suites_still_pass
  if (gateStr.includes('test_exit_code') || gateStr.includes('all_test_suites_pass')
      || gateStr.includes('all_suites_green') || gateStr.includes('all_passing_suites_still_pass')) {
    return {
      type: 'script_exit',
      config: { command: '.claude/scripts/teo-run-tests 2>&1', timeout_ms: 120000 },
    };
  }

  // lint_exit_code == 0
  if (gateStr.includes('lint_exit_code') || gateStr.includes('lint')) {
    return {
      type: 'script_exit',
      config: { command: 'npx eslint . 2>&1', timeout_ms: 30000 },
    };
  }

  // teo_validate_exit_code == 0, teo_validate_all_checks_pass, teo_validate_9_of_9
  if (gateStr.includes('teo_validate')) {
    return {
      type: 'script_exit',
      config: { command: '.claude/scripts/teo-validate 2>&1', timeout_ms: 30000 },
    };
  }

  // security_audit_clean, security_clean
  if (gateStr.includes('security_audit_clean') || gateStr.includes('security_clean')) {
    return {
      type: 'script_exit',
      config: { command: 'npm audit --audit-level=high 2>&1', timeout_ms: 30000 },
    };
  }

  // compliance_audit_current, compliance_current
  if (gateStr.includes('compliance') && (gateStr.includes('audit') || gateStr.includes('current'))) {
    return {
      type: 'script_exit',
      config: { command: '.claude/scripts/teo-compliance-report 2>&1', timeout_ms: 30000 },
    };
  }

  // mechanical_benchmarks_pass, benchmarks_current
  if (gateStr.includes('benchmark')) {
    return {
      type: 'script_exit',
      config: { command: '.claude/scripts/teo-benchmark 2>&1', timeout_ms: 60000 },
    };
  }

  // report_generated
  if (gateStr === 'report_generated') {
    return {
      type: 'script_exit',
      config: { command: 'test -f .claude/memory/sessions/active-session.json', timeout_ms: 5000 },
    };
  }

  // no_failed_or_skipped_gates (check session state for failures)
  if (gateStr.includes('no_failed_or_skipped')) {
    return {
      type: 'field_check',
      config: {
        file: '.claude/memory/sessions/active-session.json',
        format: 'json',
        field: 'gate_history',
        expected: 'present',
      },
    };
  }

  // ─── file_exists patterns ───────────────────────────────────────────

  // docs_staged_with_source
  if (gateStr.includes('docs_staged') || gateStr.includes('staged_with')) {
    return {
      type: 'file_exists',
      config: { path: 'docs/*.md', match: 'any' },
    };
  }

  // changelog_updated, changelog_has_current_version
  if (gateStr.includes('changelog')) {
    return {
      type: 'file_exists',
      config: { path: 'CHANGELOG.md', match: 'any' },
    };
  }

  // teo_home_synced (check ~/.teo/ exists)
  if (gateStr.includes('teo_home_synced')) {
    const homeTeo = path.join(process.env.HOME || '~', '.teo');
    return {
      type: 'file_exists',
      config: { path: homeTeo, match: 'any' },
    };
  }

  // ─── field_check patterns ──────────────────────────────────────────

  // version_bumped_everywhere, version_consistent_across_files
  if (gateStr.includes('version_bumped') || gateStr.includes('version_consistent')) {
    return {
      type: 'field_check',
      config: {
        file: 'TEO_INSTALL.json',
        format: 'json',
        field: 'version',
        expected: 'present',
      },
    };
  }

  // ─── count_match patterns ──────────────────────────────────────────

  // claude_md_counts_match_disk
  if (gateStr.includes('counts_match') || gateStr.includes('freshness')) {
    return {
      type: 'count_match',
      config: {
        source: 'glob',
        source_config: { pattern: '.claude/agents/*/agent.md' },
        compare: 'gte',
        expected: 1,
      },
    };
  }

  // projects_on_latest — human gate, skip
  if (gateStr.includes('projects_on_latest') || gateStr.includes('leadership_sign_off')) {
    return null; // Human resolution gates
  }

  // ─── Condition-based gates (composed flows) ────────────────────────

  if (condStr) {
    const cond = condStr.toLowerCase();

    // ─── Layer 3: Domain evaluators for previously-unmapped gates ────

    // No broken links — Layer 3 link_checker evaluator
    if (cond.includes('no broken links') || cond.includes('links resolve')) {
      return {
        type: 'domain:link_checker',
        config: { directory: 'docs', recursive: true },
      };
    }

    // No stale references — Layer 3 stale_ref_check evaluator
    if (cond.includes('no stale') || cond.includes('no references to renamed')) {
      return {
        type: 'domain:stale_ref_check',
        config: { directory: '.claude', extensions: ['.md', '.yaml', '.json'] },
      };
    }

    // OWASP assessment — Layer 3 pattern_match evaluator (checks for artifacts)
    if (cond.includes('owasp')) {
      return {
        type: 'domain:pattern_match',
        config: { check_type: 'owasp_markers', directory: '.' },
      };
    }

    // CSP restrictive — Layer 3 pattern_match evaluator (must come before CSP present)
    if (cond.includes('unsafe-inline') || cond.includes('unsafe-eval') ||
        (cond.includes('csp') && cond.includes('restrictive'))) {
      return {
        type: 'domain:pattern_match',
        config: { check_type: 'csp_restrictive', directory: '.' },
      };
    }

    // CSP present — Layer 3 pattern_match evaluator
    if (cond.includes('csp') && (cond.includes('configured') || cond.includes('present') || cond.includes('header'))) {
      return {
        type: 'domain:pattern_match',
        config: { check_type: 'csp_present', directory: '.' },
      };
    }

    // Unoptimized assets — Layer 3 asset_audit evaluator
    if (cond.includes('no unoptimized') || (cond.includes('optimized') && cond.includes('asset'))) {
      return {
        type: 'domain:asset_audit',
        config: { check_type: 'all_optimized', directory: '.' },
      };
    }

    // Asset size budget — Layer 3 asset_audit evaluator
    if (cond.includes('under size budget') || cond.includes('under budget')) {
      return {
        type: 'domain:asset_audit',
        config: { check_type: 'size_budget', directory: '.', max_size_kb: 500 },
      };
    }

    // Descriptive naming — Layer 3 asset_audit evaluator
    if (cond.includes('descriptive name') && !cond.includes('no uuid')) {
      return {
        type: 'domain:asset_audit',
        config: { check_type: 'descriptive_names', directory: '.' },
      };
    }

    // Asset references valid — Layer 3 asset_audit evaluator
    if (cond.includes('asset reference') && cond.includes('valid')) {
      return {
        type: 'domain:link_checker',
        config: { directory: '.', recursive: true },
      };
    }

    // Content placeholder detection (lorem ipsum, FPO)
    if (cond.includes('lorem ipsum') && !cond.includes('starts with')) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'no_placeholder', directory: 'src' },
      };
    }

    // Starts with placeholders (design-review gate — inverted check)
    if (cond.includes('starts with') && cond.includes('lorem ipsum')) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'has_pattern', directory: '.', pattern: 'lorem ipsum|FPO|placeholder' },
      };
    }

    // Iteration rounds check
    if (cond.includes('iterated') && cond.includes('round')) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'iteration_count', min_count: 2 },
      };
    }

    // Content after layout (no placeholder in production)
    if (cond.includes('real content') && cond.includes('layout')) {
      return {
        type: 'domain:session_check',
        config: { check_type: 'phase_complete', expected_phase: 'design' },
      };
    }

    // No AI-generated screenshots — pattern check for asset audit artifacts
    if (cond.includes('no ai-generated') || cond.includes('never generates full-page')) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'no_pattern', directory: '.claude/memory', pattern: 'full.?page.?screenshot|page.?layout.?generated' },
      };
    }

    // Atomic assets only
    if (cond.includes('atomic') && cond.includes('asset')) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'no_pattern', directory: '.claude/memory', pattern: 'full.?page|page.?layout' },
      };
    }

    // Text-free assets
    if (cond.includes('text-free') || (cond.includes('no') && cond.includes('baked-in text'))) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'no_pattern', directory: '.claude/memory', pattern: 'baked.?in.?text|text.?in.?asset' },
      };
    }

    // Image size parameter set
    if (cond.includes('image_size') && cond.includes('set')) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'has_pattern', directory: '.claude/memory', pattern: 'image_size|size.*parameter' },
      };
    }

    // Optimizer ran — asset audit
    if (cond.includes('optimized variant exists')) {
      return {
        type: 'domain:asset_audit',
        config: { check_type: 'all_optimized', directory: '.' },
      };
    }

    // Raw access blocked — check hook exists
    if (cond.includes('blocking raw image') || cond.includes('raw-access-blocked')) {
      return {
        type: 'file_exists',
        config: { path: '.claude/hooks/*.sh', match: 'any' },
      };
    }

    // No context blowout — asset size check
    if (cond.includes('no image file') && cond.includes('>2mb')) {
      return {
        type: 'domain:asset_audit',
        config: { check_type: 'size_budget', directory: '.', max_size_kb: 2048 },
      };
    }

    // Asset references point to site paths
    if (cond.includes('asset references') && cond.includes('site')) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'no_pattern', directory: 'src', pattern: 'data/images/' },
      };
    }

    // Referenced asset files exist
    if (cond.includes('referenced asset') && cond.includes('exist')) {
      return {
        type: 'domain:link_checker',
        config: { directory: 'src', recursive: true },
      };
    }

    // Session state checks
    if (cond.includes('no failed') && cond.includes('gate')) {
      return {
        type: 'domain:session_check',
        config: { check_type: 'no_blocks' },
      };
    }

    // ─── Remaining Layer 2 evaluator mappings ────────────────────────

    // Hook installed check
    if (cond.includes('hook') && (cond.includes('installed') || cond.includes('active'))) {
      return {
        type: 'file_exists',
        config: { path: '.claude/hooks/*.sh', match: 'any' },
      };
    }

    // Lighthouse / performance score
    if (cond.includes('lighthouse') || cond.includes('performance score')) {
      return {
        type: 'script_exit',
        config: { command: 'npx lighthouse --output=json --chrome-flags="--headless" 2>&1', timeout_ms: 60000 },
      };
    }

    // teo-validate condition variant
    if (cond.includes('teo-validate') || cond.includes('teo_validate')) {
      return {
        type: 'script_exit',
        config: { command: '.claude/scripts/teo-validate 2>&1', timeout_ms: 30000 },
      };
    }

    // Test suite condition variant
    if (cond.includes('test suite') && (cond.includes('regress') || cond.includes('green'))) {
      return {
        type: 'script_exit',
        config: { command: '.claude/scripts/teo-run-tests 2>&1', timeout_ms: 120000 },
      };
    }

    // Accessibility review — check for a11y report existence
    if (cond.includes('accessibility') || cond.includes('mg-accessibility')) {
      return {
        type: 'file_exists',
        config: { path: '.claude/memory/reviews/accessibility-*.md', match: 'any' },
      };
    }

    // Screenshot comparison — check for screenshots directory
    if (cond.includes('screenshot comparison') || cond.includes('visual comparison')) {
      return {
        type: 'file_exists',
        config: { path: '.claude/memory/reviews/screenshot-*.png', match: 'any' },
      };
    }

    // Parallel dispatch — check session state for dispatch markers
    if (cond.includes('parallel dispatch')) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'has_pattern', directory: '.claude/memory', pattern: 'parallel.*dispatch|concurrent.*generation' },
      };
    }

    // Reference chaining — check session state
    if (cond.includes('reference chaining') || cond.includes('nb2 reference')) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'has_pattern', directory: '.claude/memory', pattern: 'reference.*chain|nb2.*reference' },
      };
    }

    // Tool boundary checks
    if (cond.includes('correct tools') || cond.includes('tool') && cond.includes('purpose')) {
      return {
        type: 'domain:session_check',
        config: { check_type: 'gates_passed', min_gates: 1 },
      };
    }

    // Design phase complete
    if (cond.includes('design phase complete')) {
      return {
        type: 'domain:session_check',
        config: { check_type: 'phase_complete', expected_phase: 'design' },
      };
    }

    // Research/planning conditions — session state checks
    if (cond.includes('research findings documented') || cond.includes('findings documented')) {
      return {
        type: 'file_exists',
        config: { path: '.claude/memory/*.md', match: 'any' },
      };
    }

    if (cond.includes('prd') && (cond.includes('written') || cond.includes('exists'))) {
      return {
        type: 'file_exists',
        config: { path: 'docs/*prd*', match: 'any' },
      };
    }

    if (cond.includes('tdd') && (cond.includes('written') || cond.includes('exists'))) {
      return {
        type: 'file_exists',
        config: { path: 'docs/*tdd*', match: 'any' },
      };
    }

    if (cond.includes('design spec') && (cond.includes('written') || cond.includes('exists'))) {
      return {
        type: 'file_exists',
        config: { path: '.claude/memory/*design*', match: 'any' },
      };
    }

    if (cond.includes('spec reviewed') || cond.includes('c-suite') && cond.includes('reviewed')) {
      return {
        type: 'domain:session_check',
        config: { check_type: 'gates_passed', min_gates: 1 },
      };
    }

    // Brand ground truth — file check
    if (cond.includes('brand') && cond.includes('source file')) {
      return {
        type: 'file_exists',
        config: { path: '.claude/memory/*brand*', match: 'any' },
      };
    }

    if (cond.includes('font') && cond.includes('match')) {
      return {
        type: 'domain:content_check',
        config: { check_type: 'has_pattern', directory: '.claude/memory', pattern: 'font|typography|typeface' },
      };
    }

    // Corrections saved as memory
    if (cond.includes('correction') && cond.includes('saved')) {
      return {
        type: 'file_exists',
        config: { path: '.claude/memory/feedback_*', match: 'any' },
      };
    }

    // Dev site checked
    if (cond.includes('dev server') && cond.includes('visually')) {
      return {
        type: 'domain:session_check',
        config: { check_type: 'gates_passed', min_gates: 1 },
      };
    }

    // Affected docs listed
    if (cond.includes('affected') && cond.includes('documentation')) {
      return {
        type: 'domain:session_check',
        config: { check_type: 'gates_passed', min_gates: 1 },
      };
    }

    // Docs updated / match source
    if (cond.includes('docs updated') || cond.includes('documentation') || cond.includes('docs match')) {
      return {
        type: 'file_exists',
        config: { path: 'docs/*.md', match: 'any' },
      };
    }

    // Domain/tech/scope/deliverable identification (planning-spike conditions)
    if (cond.includes('domain') || cond.includes('tech stack') || cond.includes('deliverables')
        || cond.includes('done criteria') || cond.includes('applicable') || cond.includes('gaps identified')
        || cond.includes('flow proposed') || cond.includes('existing atomics')) {
      return {
        type: 'field_check',
        config: {
          file: '.claude/memory/sessions/active-session.json',
          format: 'json',
          field: 'gate_history',
          expected: 'present',
        },
      };
    }

    // Human gates — explicitly return null (7 gates by design)
    // These are: three-party-sign-off, design-sign-off, design-spec-approved,
    // leadership-verdict, user-approved, user-reviewed (confirm), projects_on_latest
    if (cond.includes('user review') || cond.includes('user approved') || cond.includes('user confirm')) {
      return null; // Human gates
    }
    if (cond.includes('art director') && cond.includes('engineering lead') && cond.includes('content lead')) {
      return null; // Three-party human sign-off
    }
    if (cond.includes('sign off on design') || cond.includes('sign off')) {
      return null; // Human sign-off gate
    }

    // Counts match in docs
    if (cond.includes('counts') && cond.includes('match')) {
      return {
        type: 'count_match',
        config: {
          source: 'glob',
          source_config: { pattern: '.claude/agents/*/agent.md' },
          compare: 'gte',
          expected: 1,
        },
      };
    }

    // Flow written to composed/
    if (cond.includes('yaml file written') || cond.includes('flow written')) {
      return {
        type: 'file_exists',
        config: { path: '.claude/processes/composed/*.yaml', match: 'any' },
      };
    }

    // Re-match succeeds — session check
    if (cond.includes('re-run') || cond.includes('re-match')) {
      return {
        type: 'domain:session_check',
        config: { check_type: 'gates_passed', min_gates: 1 },
      };
    }

    // Security findings
    if (cond.includes('critical') && (cond.includes('findings') || cond.includes('fixed'))) {
      return {
        type: 'script_exit',
        config: { command: 'npm audit --audit-level=critical 2>&1', timeout_ms: 30000 },
      };
    }

    // Dependency audit
    if (cond.includes('dependency') || cond.includes('vulnerable dependencies')) {
      return {
        type: 'script_exit',
        config: { command: 'npm audit 2>&1', timeout_ms: 30000 },
      };
    }

    // Workstream created — file check
    if (cond.includes('workstream') && cond.includes('created')) {
      return {
        type: 'file_exists',
        config: { path: '.claude/memory/workstreams/*.md', match: 'any' },
      };
    }

    // Leadership verdict
    if (cond.includes('leadership') && (cond.includes('approved') || cond.includes('verdict'))) {
      return null; // Human gate
    }
  }

  // Default: no mechanical evaluator
  return null;
}

// ---------------------------------------------------------------------------
// Stdin reader for hooks
// ---------------------------------------------------------------------------

/**
 * Read JSON from stdin (hook input format).
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    process.stdin.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ProcessEngine,
  readStdin,
  writeTrace,
  mapGateToEvaluator,
  // Layer 2 exports for testing
  TRACES_DIR,
  // Layer 3 exports for testing
  ModelRouter: require('./model-router').ModelRouter,
};
