/**
 * Model Router — TEO Runtime Engine Layer 3
 *
 * Routes tasks to appropriate model tiers based on complexity analysis.
 * Target: -30-40% token cost reduction by routing mechanical/low-complexity
 * tasks to smaller models and reserving Opus for judgment-heavy work.
 *
 * Three model tiers:
 *   1. FAST   — Haiku: mechanical checks, file validation, formatting
 *   2. MEDIUM — Sonnet: code review, documentation, standard analysis
 *   3. DEEP   — Opus: architecture decisions, security analysis, judgment calls
 *
 * The router does NOT call models — it classifies tasks and returns routing
 * recommendations that the orchestrator uses to select the appropriate model.
 */

'use strict';

const path = require('path');

// ---------------------------------------------------------------------------
// Model tiers
// ---------------------------------------------------------------------------

const MODEL_TIERS = {
  FAST: {
    name: 'haiku',
    cost_multiplier: 0.04,  // ~4% of Opus cost
    max_complexity: 2,
    description: 'Mechanical checks, validation, formatting',
  },
  MEDIUM: {
    name: 'sonnet',
    cost_multiplier: 0.2,   // ~20% of Opus cost
    max_complexity: 5,
    description: 'Code review, documentation, standard analysis',
  },
  DEEP: {
    name: 'opus',
    cost_multiplier: 1.0,   // Baseline
    max_complexity: 10,
    description: 'Architecture, security judgment, strategic decisions',
  },
};

// ---------------------------------------------------------------------------
// Task classification rules
// ---------------------------------------------------------------------------

/**
 * Classification rules map task patterns to model tiers.
 * Each rule has: pattern (regex on task description), tier, and rationale.
 */
const CLASSIFICATION_RULES = [
  // FAST tier — mechanical, no judgment needed
  { pattern: /file.?exist|file.?check|directory.?check/i, tier: 'FAST', rationale: 'File existence is a mechanical check' },
  { pattern: /count.?match|count.?check|count.?verify/i, tier: 'FAST', rationale: 'Counting is mechanical' },
  { pattern: /field.?check|field.?present|json.?field/i, tier: 'FAST', rationale: 'Field presence is mechanical' },
  { pattern: /lint|format|prettier|eslint/i, tier: 'FAST', rationale: 'Linting is tool-based, no judgment' },
  { pattern: /version.?bump|version.?check|version.?match/i, tier: 'FAST', rationale: 'Version verification is mechanical' },
  { pattern: /changelog.?exist|changelog.?check/i, tier: 'FAST', rationale: 'Changelog existence is mechanical' },
  { pattern: /teo.?validate|framework.?validate|structural.?check/i, tier: 'FAST', rationale: 'Framework validation is scripted' },
  { pattern: /glob.?match|pattern.?match|file.?pattern/i, tier: 'FAST', rationale: 'Pattern matching is mechanical' },
  { pattern: /hook.?installed|hook.?active|hook.?exists/i, tier: 'FAST', rationale: 'Hook existence is a file check' },
  { pattern: /test.?exit|test.?pass|suite.?green/i, tier: 'FAST', rationale: 'Test execution is tool-based' },
  { pattern: /npm.?audit|dependency.?scan|dependency.?audit/i, tier: 'FAST', rationale: 'Dependency scanning is tool-based' },
  { pattern: /benchmark|perf.?budget/i, tier: 'FAST', rationale: 'Benchmarks are scripted' },
  { pattern: /compliance.?report|compliance.?audit/i, tier: 'FAST', rationale: 'Compliance report is scripted' },
  { pattern: /report.?generated|trace.?written/i, tier: 'FAST', rationale: 'Report generation is mechanical' },
  { pattern: /asset.?size|image.?size|file.?size/i, tier: 'FAST', rationale: 'Size checking is mechanical' },
  { pattern: /optimize|compress|resize/i, tier: 'FAST', rationale: 'Optimization is tool-based' },

  // MEDIUM tier — requires some analysis but not deep judgment
  { pattern: /code.?review|review.?code/i, tier: 'MEDIUM', rationale: 'Code review needs analysis but is pattern-based' },
  { pattern: /doc.?update|documentation|doc.?fresh/i, tier: 'MEDIUM', rationale: 'Doc updates need content understanding' },
  { pattern: /link.?check|broken.?link|stale.?ref/i, tier: 'MEDIUM', rationale: 'Link checking needs path resolution' },
  { pattern: /research|assess|analyze/i, tier: 'MEDIUM', rationale: 'Research needs comprehension' },
  { pattern: /scope|deliverable|requirement/i, tier: 'MEDIUM', rationale: 'Scoping needs domain understanding' },
  { pattern: /planning|spec|design.?spec/i, tier: 'MEDIUM', rationale: 'Planning needs synthesis' },
  { pattern: /accessibility|wcag|a11y/i, tier: 'MEDIUM', rationale: 'Accessibility review is checklist-heavy' },
  { pattern: /brand.?check|brand.?match|brand.?ground/i, tier: 'MEDIUM', rationale: 'Brand matching needs visual understanding' },
  { pattern: /screenshot|visual.?compare/i, tier: 'MEDIUM', rationale: 'Visual comparison needs image analysis' },
  { pattern: /correction.?persist|feedback.?save/i, tier: 'MEDIUM', rationale: 'Correction persistence is structured' },

  // DEEP tier — requires judgment, security analysis, or strategic thinking
  { pattern: /owasp|security.?review|security.?assess/i, tier: 'DEEP', rationale: 'Security assessment needs expert judgment' },
  { pattern: /csp.?audit|csp.?review|content.?security/i, tier: 'DEEP', rationale: 'CSP analysis needs security expertise' },
  { pattern: /architecture|design.?decision|tech.?decision/i, tier: 'DEEP', rationale: 'Architecture needs deep judgment' },
  { pattern: /leadership|executive|strategic/i, tier: 'DEEP', rationale: 'Strategic decisions need broad context' },
  { pattern: /remediat|fix.?security|patch.?vuln/i, tier: 'DEEP', rationale: 'Security remediation needs expert judgment' },
  { pattern: /design.?quality|ux.?review|design.?sign/i, tier: 'DEEP', rationale: 'Design quality is subjective judgment' },
  { pattern: /user.?approv|human.?gate|sign.?off/i, tier: 'DEEP', rationale: 'Human gates need context for escalation' },
  { pattern: /flow.?propos|process.?design|spike/i, tier: 'DEEP', rationale: 'Process design needs architectural thinking' },
];

// ---------------------------------------------------------------------------
// Model Router class
// ---------------------------------------------------------------------------

class ModelRouter {
  constructor(options = {}) {
    this.rules = CLASSIFICATION_RULES;
    this.routingHistory = [];
    this.costSavings = { total_tasks: 0, fast_routed: 0, medium_routed: 0, deep_routed: 0, estimated_savings_pct: 0 };
    this.defaultTier = options.defaultTier || 'DEEP'; // Safe default
  }

  /**
   * Classify a task and return a model routing recommendation.
   *
   * @param {string} taskDescription - Description of the task
   * @param {object} [context] - Additional context for classification
   * @param {string} [context.gate_name] - Name of the gate being evaluated
   * @param {string} [context.evaluator_type] - Type of evaluator
   * @param {string} [context.flow_name] - Name of the active flow
   * @param {string} [context.resolution] - Gate resolution type (auto|human)
   * @returns {{ tier: string, model: object, rationale: string, confidence: number }}
   */
  route(taskDescription, context = {}) {
    // Human gates always route to DEEP (need context for escalation)
    if (context.resolution === 'human') {
      return this._makeRouting('DEEP', 'Human gate requires full context for escalation', 1.0);
    }

    // Script-based evaluators always route to FAST
    if (context.evaluator_type === 'script_exit' || context.evaluator_type === 'file_exists' ||
        context.evaluator_type === 'count_match' || context.evaluator_type === 'field_check') {
      return this._makeRouting('FAST', `Evaluator type ${context.evaluator_type} is mechanical`, 1.0);
    }

    // Domain-specific evaluators route to MEDIUM
    if (context.evaluator_type === 'domain_evaluator') {
      return this._makeRouting('MEDIUM', 'Domain evaluator needs analysis but follows patterns', 0.9);
    }

    // Pattern match against task description
    const combined = [
      taskDescription || '',
      context.gate_name || '',
      context.flow_name || '',
    ].join(' ');

    for (const rule of this.rules) {
      if (rule.pattern.test(combined)) {
        return this._makeRouting(rule.tier, rule.rationale, 0.85);
      }
    }

    // Default to DEEP for unclassified tasks (safe)
    return this._makeRouting(this.defaultTier, 'No classification rule matched — using safe default', 0.5);
  }

  /**
   * Route a gate evaluation and return the recommended model tier.
   *
   * @param {object} gate - Gate definition from flow registry
   * @returns {{ tier: string, model: object, rationale: string, confidence: number }}
   */
  routeGate(gate) {
    const description = [
      gate.gate || '',
      gate.condition || '',
      gate.name || '',
    ].join(' ');

    return this.route(description, {
      gate_name: gate.name,
      evaluator_type: gate._evaluator_type,
      flow_name: gate.flow_name,
      resolution: gate.resolution,
    });
  }

  /**
   * Get cost optimization summary.
   * Calculates estimated savings based on routing history.
   */
  getCostSummary() {
    if (this.routingHistory.length === 0) {
      return { ...this.costSavings, estimated_savings_pct: 0 };
    }

    const totalTasks = this.routingHistory.length;
    const fastCount = this.routingHistory.filter(r => r.tier === 'FAST').length;
    const mediumCount = this.routingHistory.filter(r => r.tier === 'MEDIUM').length;
    const deepCount = this.routingHistory.filter(r => r.tier === 'DEEP').length;

    // Calculate weighted cost vs all-Opus baseline
    const weightedCost = (
      fastCount * MODEL_TIERS.FAST.cost_multiplier +
      mediumCount * MODEL_TIERS.MEDIUM.cost_multiplier +
      deepCount * MODEL_TIERS.DEEP.cost_multiplier
    );
    const baselineCost = totalTasks * MODEL_TIERS.DEEP.cost_multiplier;
    const savingsPct = baselineCost > 0
      ? ((baselineCost - weightedCost) / baselineCost * 100)
      : 0;

    return {
      total_tasks: totalTasks,
      fast_routed: fastCount,
      medium_routed: mediumCount,
      deep_routed: deepCount,
      estimated_savings_pct: Math.round(savingsPct * 10) / 10,
      cost_breakdown: {
        all_opus_baseline: baselineCost,
        routed_cost: Math.round(weightedCost * 100) / 100,
      },
    };
  }

  /**
   * Simulate routing all gates from a flow registry.
   * Used for cost estimation before execution.
   *
   * @param {object} registry - FlowRegistry instance
   * @returns {{ summary: object, gate_routings: object[] }}
   */
  simulateFlowRouting(registry) {
    const gateRoutings = [];

    for (const flowName of registry.getAllFlowNames()) {
      const flow = registry.getFlow(flowName);
      if (!flow) continue;

      // Collect all gates from phases
      const gates = this._collectGatesFromFlow(flow);
      for (const gate of gates) {
        const routing = this.routeGate({ ...gate, flow_name: flowName });
        gateRoutings.push({
          flow: flowName,
          gate: gate.name || gate.gate || 'unnamed',
          ...routing,
        });
      }
    }

    return {
      summary: this.getCostSummary(),
      gate_routings: gateRoutings,
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────

  _makeRouting(tier, rationale, confidence) {
    const model = MODEL_TIERS[tier] || MODEL_TIERS.DEEP;
    const routing = {
      tier,
      model: { ...model },
      rationale,
      confidence,
      timestamp: new Date().toISOString(),
    };

    this.routingHistory.push(routing);
    return routing;
  }

  _collectGatesFromFlow(flow) {
    const gates = [];

    // Phases with direct gates
    if (flow.phases && Array.isArray(flow.phases)) {
      for (const phase of flow.phases) {
        if (!phase) continue;
        if (phase.gates && Array.isArray(phase.gates)) {
          for (const g of phase.gates) {
            if (g) gates.push(g);
          }
        } else if (phase.gate) {
          gates.push(phase);
        }
      }
    }

    // Composed flow gates
    if (flow.gates && Array.isArray(flow.gates)) {
      for (const g of flow.gates) {
        if (g) gates.push(g);
      }
    }

    return gates;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ModelRouter,
  MODEL_TIERS,
  CLASSIFICATION_RULES,
};
