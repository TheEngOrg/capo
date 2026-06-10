/**
 * Flow Registry — TEO Runtime Engine Layer 1
 *
 * Loads all YAML process flows from .claude/processes/atomic/ and
 * .claude/processes/composed/, validates required fields, resolves
 * composed flow references, and builds an in-memory registry.
 *
 * The registry is immutable for session duration.
 *
 * See: .claude/shared/harness-protocol.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Minimal YAML parser (no dependencies)
// ---------------------------------------------------------------------------
// Handles the subset of YAML used in process flow files:
// - top-level scalar fields (kind, name, version, enforcement)
// - lists of objects (phases, gates, composes)
// - nested scalars within list items
// - multi-line strings (|)

function parseYaml(content) {
  const result = {};
  const lines = content.split('\n');
  let i = 0;

  // Skip comment header
  while (i < lines.length && (lines[i].startsWith('#') || lines[i].trim() === '')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    // Top-level key
    const topMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (!topMatch) {
      i++;
      continue;
    }

    const key = topMatch[1];
    const inlineValue = topMatch[2].trim();

    // Multi-line string (|)
    if (inlineValue === '|') {
      i++;
      let block = '';
      const baseIndent = getIndent(lines[i] || '');
      while (i < lines.length && (lines[i].trim() === '' || getIndent(lines[i]) >= baseIndent)) {
        block += lines[i].slice(baseIndent) + '\n';
        i++;
      }
      result[key] = block.trimEnd();
      continue;
    }

    // List
    if (inlineValue === '' && i + 1 < lines.length && lines[i + 1].trim().startsWith('-')) {
      i++;
      result[key] = parseList(lines, i, getIndent(lines[i]));
      // Advance past the list
      while (i < lines.length) {
        const indent = getIndent(lines[i]);
        if (lines[i].trim() === '' || lines[i].trim().startsWith('#')) {
          i++;
          continue;
        }
        if (indent === 0 && !lines[i].trim().startsWith('-')) break;
        if (indent < getIndent(lines[Math.max(0, i - 1)]) && !lines[i].trim().startsWith('-')) break;
        i++;
      }
      continue;
    }

    // Simple scalar
    result[key] = parseScalar(inlineValue);
    i++;
  }

  return result;
}

function parseList(lines, startIdx, baseIndent) {
  const items = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    const indent = getIndent(line);

    // Outdented = end of list
    if (indent < baseIndent && line.trim() !== '') break;

    // List item
    if (line.trim().startsWith('-')) {
      const itemContent = line.trim().slice(1).trim();

      // Simple scalar item (e.g., "- brand-kit")
      if (itemContent && !itemContent.includes(':')) {
        items.push(parseScalar(itemContent));
        i++;
        continue;
      }

      // Object item
      const obj = {};
      if (itemContent && itemContent.includes(':')) {
        const kvMatch = itemContent.match(/^(\w[\w-]*)\s*:\s*(.*)/);
        if (kvMatch) {
          obj[kvMatch[1]] = handleNestedValue(kvMatch[2].trim(), lines, i + 1);
        }
      }

      // Read subsequent indented lines as more fields of this object
      i++;
      const itemIndent = i < lines.length ? getIndent(lines[i]) : baseIndent + 2;
      while (i < lines.length) {
        const subLine = lines[i];
        if (subLine.trim() === '' || subLine.trim().startsWith('#')) {
          i++;
          continue;
        }
        const subIndent = getIndent(subLine);
        if (subIndent < itemIndent) break;
        if (subLine.trim().startsWith('-') && subIndent <= baseIndent) break;

        const kvMatch = subLine.trim().match(/^(\w[\w-]*)\s*:\s*(.*)/);
        if (kvMatch) {
          // If it was a multi-line block, parse it
          if (kvMatch[2].trim() === '|') {
            i++;
            let block = '';
            const blockIndent = i < lines.length ? getIndent(lines[i]) : subIndent + 2;
            while (i < lines.length && (lines[i].trim() === '' || getIndent(lines[i]) >= blockIndent)) {
              block += lines[i].slice(blockIndent) + '\n';
              i++;
            }
            obj[kvMatch[1]] = block.trimEnd();
            continue;
          }

          // Layer 2: If it was a nested list, recursively parse it
          if (kvMatch[2].trim() === '' && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (nextLine && nextLine.trim().startsWith('-')) {
              const nestedIndent = getIndent(nextLine);
              i++;
              obj[kvMatch[1]] = parseList(lines, i, nestedIndent);
              // Advance past the nested list
              while (i < lines.length) {
                if (lines[i].trim() === '' || lines[i].trim().startsWith('#')) {
                  i++;
                  continue;
                }
                if (getIndent(lines[i]) < nestedIndent) break;
                i++;
              }
              continue;
            }
            // Nested map or empty — skip
            if (nextLine && getIndent(nextLine) > subIndent) {
              i++;
              while (i < lines.length && (lines[i].trim() === '' || getIndent(lines[i]) > subIndent)) {
                i++;
              }
              obj[kvMatch[1]] = null;
              continue;
            }
          }

          obj[kvMatch[1]] = handleNestedValue(kvMatch[2].trim(), lines, i + 1);
        }
        i++;
      }

      items.push(Object.keys(obj).length > 0 ? obj : itemContent || null);
      continue;
    }

    i++;
  }

  return items;
}

function handleNestedValue(inlineValue, lines, nextIdx) {
  if (inlineValue === '|') {
    // Multi-line block — just return placeholder, we skip in the caller
    return '[multi-line]';
  }
  if (inlineValue === '') {
    return null;
  }
  return parseScalar(inlineValue);
}

function parseScalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  // Strip surrounding quotes
  return value.replace(/^["']|["']$/g, '');
}

function getIndent(line) {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

// ---------------------------------------------------------------------------
// Flow loader
// ---------------------------------------------------------------------------

/**
 * Load all flows from the processes directory.
 * @param {string} projectRoot
 * @returns {{ flows: Map, atomicCount: number, composedCount: number, skipped: number, errors: string[] }}
 */
function loadFlows(projectRoot) {
  const atomicDir = path.join(projectRoot, '.claude', 'processes', 'atomic');
  const composedDir = path.join(projectRoot, '.claude', 'processes', 'composed');

  const flows = new Map();
  const errors = [];
  let atomicCount = 0;
  let composedCount = 0;
  let skipped = 0;

  // Load atomic flows
  if (fs.existsSync(atomicDir)) {
    for (const file of fs.readdirSync(atomicDir)) {
      if (!file.endsWith('.yaml')) continue;
      try {
        const filePath = path.join(atomicDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const flow = parseYaml(content);
        flow._path = filePath;

        if (!validateFlow(flow, errors, file)) {
          skipped++;
          continue;
        }

        flows.set(flow.name, flow);
        atomicCount++;
      } catch (err) {
        errors.push(`${file}: ${err.message}`);
        skipped++;
      }
    }
  }

  // Load composed flows
  if (fs.existsSync(composedDir)) {
    for (const file of fs.readdirSync(composedDir)) {
      if (!file.endsWith('.yaml')) continue;
      try {
        const filePath = path.join(composedDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const flow = parseYaml(content);
        flow._path = filePath;

        if (!validateFlow(flow, errors, file)) {
          skipped++;
          continue;
        }

        // Resolve composed references
        if (flow.composes && Array.isArray(flow.composes)) {
          for (const ref of flow.composes) {
            if (ref && ref.ref) {
              const refName = ref.ref.replace('atomic/', '');
              if (flows.has(refName)) {
                ref._resolved = flows.get(refName);
              }
            }
          }
        }

        flows.set(flow.name, flow);
        composedCount++;
      } catch (err) {
        errors.push(`${file}: ${err.message}`);
        skipped++;
      }
    }
  }

  return { flows, atomicCount, composedCount, skipped, errors };
}

/**
 * Validate required fields on a flow.
 */
function validateFlow(flow, errors, fileName) {
  const required = ['kind', 'name', 'version', 'enforcement'];
  for (const field of required) {
    if (flow[field] == null) {
      errors.push(`${fileName}: missing required field '${field}'`);
      return false;
    }
  }

  if (flow.kind !== 'atomic' && flow.kind !== 'composed') {
    errors.push(`${fileName}: kind must be 'atomic' or 'composed', got '${flow.kind}'`);
    return false;
  }

  if (flow.kind === 'atomic' && !Array.isArray(flow.phases)) {
    errors.push(`${fileName}: atomic flows require 'phases' list`);
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Registry class
// ---------------------------------------------------------------------------

class FlowRegistry {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.flows = new Map();
    this.triggerKeywords = new Map(); // keyword -> [flowName]
    this.loaded = false;
    this.loadSummary = null;
  }

  /**
   * Load all flows and build the registry.
   */
  load() {
    const result = loadFlows(this.projectRoot);
    this.flows = result.flows;
    this.loaded = true;

    // Build trigger keyword index
    for (const [name, flow] of this.flows) {
      // Index by flow name parts
      const parts = name.split('-');
      for (const part of parts) {
        this.addTriggerKeyword(part, name);
      }

      // Index by trigger patterns if present
      if (flow.trigger && flow.trigger.patterns) {
        for (const pattern of flow.trigger.patterns) {
          const ext = pattern.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\./g, '');
          if (ext) this.addTriggerKeyword(ext, name);
        }
      }

      // Index by phase names
      if (flow.phases) {
        for (const phase of flow.phases) {
          if (phase && phase.name) {
            this.addTriggerKeyword(phase.name, name);
          }
        }
      }

      // Index by phase_order entries
      if (flow.phase_order) {
        for (const phase of flow.phase_order) {
          if (typeof phase === 'string') {
            this.addTriggerKeyword(phase, name);
          }
        }
      }
    }

    this.loadSummary = {
      total: result.atomicCount + result.composedCount,
      atomic: result.atomicCount,
      composed: result.composedCount,
      skipped: result.skipped,
      errors: result.errors,
    };

    return this.loadSummary;
  }

  addTriggerKeyword(keyword, flowName) {
    const k = keyword.toLowerCase();
    if (!this.triggerKeywords.has(k)) {
      this.triggerKeywords.set(k, []);
    }
    const list = this.triggerKeywords.get(k);
    if (!list.includes(flowName)) {
      list.push(flowName);
    }
  }

  /**
   * Get a flow by name.
   */
  getFlow(name) {
    return this.flows.get(name) || null;
  }

  /**
   * Get all flow names.
   */
  getAllFlowNames() {
    return [...this.flows.keys()];
  }

  /**
   * Get gates for a specific phase of a flow.
   * For atomic flows, returns phases matching the phase name.
   * For composed flows, returns both composed-specific gates and atomic gates mapped to that phase.
   */
  getGatesForPhase(flowName, phaseName) {
    const flow = this.flows.get(flowName);
    if (!flow) return [];

    const gates = [];

    // Composed-specific gates
    if (flow.gates && Array.isArray(flow.gates)) {
      for (const gate of flow.gates) {
        if (gate && gate.phase === phaseName) {
          gates.push({
            ...gate,
            source: 'composed',
            flow_name: flowName,
          });
        }
      }
    }

    // Atomic phases (direct or via compose references)
    if (flow.kind === 'atomic' && flow.phases) {
      for (const phase of flow.phases) {
        if (phase && phase.name === phaseName) {
          gates.push({
            name: phase.name,
            gate: phase.gate,
            on_fail: phase.on_fail || 'warn',
            resolution: phase.resolution || 'auto',
            source: 'atomic',
            flow_name: flowName,
          });
        }
      }
    }

    // Composed flow: collect gates from referenced atomic flows
    if (flow.kind === 'composed' && flow.composes) {
      for (const ref of flow.composes) {
        if (!ref || !ref.phase_mapping || !ref._resolved) continue;
        const atomicFlow = ref._resolved;

        // Find atomic phases mapped to this composed phase
        for (const [atomicPhase, composedPhase] of Object.entries(ref.phase_mapping)) {
          if (composedPhase === phaseName && atomicFlow.phases) {
            const phase = atomicFlow.phases.find(p => p && p.name === atomicPhase);
            if (phase) {
              gates.push({
                name: `${atomicFlow.name}/${phase.name}`,
                gate: phase.gate,
                on_fail: phase.on_fail || 'warn',
                resolution: phase.resolution || 'auto',
                source: 'atomic-ref',
                flow_name: atomicFlow.name,
              });
            }
          }
        }
      }
    }

    return gates;
  }

  /**
   * Match a command or action against flow trigger patterns.
   * Returns array of { flowName, gateName, gate } for matching gates.
   */
  getGatesTriggeredByCommand(command) {
    const matched = [];

    for (const [name, flow] of this.flows) {
      if (!flow.trigger || !flow.trigger.patterns) continue;

      for (const pattern of flow.trigger.patterns) {
        // Convert glob to regex
        const regexStr = pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\./g, '\\.');
        const regex = new RegExp(regexStr);

        // Check if the command references files matching the pattern
        if (regex.test(command)) {
          // Return first-phase gates for this flow
          const phases = flow.phase_order || (flow.phases ? flow.phases.map(p => p.name) : []);
          if (phases.length > 0) {
            const firstPhaseGates = this.getGatesForPhase(name, phases[0]);
            for (const gate of firstPhaseGates) {
              matched.push({ flowName: name, ...gate });
            }
          }
          break; // matched this flow, don't check more patterns
        }
      }
    }

    return matched;
  }

  /**
   * Format the loading summary as a harness protocol string.
   */
  formatSummary() {
    if (!this.loadSummary) return '[HARNESS] Not loaded.';
    const s = this.loadSummary;
    return `[HARNESS] Loaded ${s.total} flows (${s.atomic} atomic, ${s.composed} composed). ${s.skipped} skipped.`;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  FlowRegistry,
  loadFlows,
  parseYaml,
};
