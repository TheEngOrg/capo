/**
 * Session State Manager — TEO Runtime Engine Layer 2
 *
 * Maintains session state in a JSON file for the process engine.
 * Tracks active flow, current phase, gate history, context pressure,
 * and pending gates.
 *
 * Layer 2 additions:
 *   - Lock-based sessions (prevent concurrent session corruption)
 *   - Session archiving with gate summaries
 *   - Handoff state for cross-session continuity
 *
 * See: docs/runtime-engine-architecture.md (Session State section)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = '.claude/memory/sessions';
const ACTIVE_SESSION_FILE = 'active-session.json';
const LOCK_FILE = 'session.lock';
const LOCK_TIMEOUT_MS = 300000; // 5 minutes — stale lock threshold

// ---------------------------------------------------------------------------
// Session state schema
// ---------------------------------------------------------------------------

function createSessionState(sessionId, opts = {}) {
  return {
    session_id: sessionId,
    started_at: new Date().toISOString(),
    active_flow: opts.active_flow || null,
    current_phase: opts.current_phase || null,
    gate_history: [],
    token_estimate: 0,
    context_pressure: 'low',
    pending_gates: [],
    workstream_id: opts.workstream_id || null,
    engineer_id: opts.engineer_id || null,
  };
}

// ---------------------------------------------------------------------------
// SessionManager class
// ---------------------------------------------------------------------------

class SessionManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.sessionsDir = path.join(projectRoot, SESSIONS_DIR);
    this.activeSessionPath = path.join(this.sessionsDir, ACTIVE_SESSION_FILE);
    this.lockPath = path.join(this.sessionsDir, LOCK_FILE);
    this.state = null;
    this.hasLock = false;
  }

  /**
   * Ensure sessions directory exists.
   */
  ensureDir() {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Layer 2: Acquire session lock.
   * Uses a lock file with PID and timestamp. Stale locks (>5 min) are broken.
   * @returns {boolean} true if lock acquired
   */
  acquireLock() {
    this.ensureDir();

    if (fs.existsSync(this.lockPath)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
        const lockAge = Date.now() - new Date(lockData.acquired_at).getTime();

        if (lockAge < LOCK_TIMEOUT_MS) {
          // Active lock held by another process
          return false;
        }
        // Stale lock — break it
      } catch {
        // Corrupted lock — break it
      }
    }

    const lockData = {
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      session_id: this.state ? this.state.session_id : 'pending',
    };
    fs.writeFileSync(this.lockPath, JSON.stringify(lockData, null, 2) + '\n', 'utf8');
    this.hasLock = true;
    return true;
  }

  /**
   * Layer 2: Release session lock.
   */
  releaseLock() {
    if (this.hasLock && fs.existsSync(this.lockPath)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
        // Only release our own lock
        if (lockData.pid === process.pid) {
          fs.unlinkSync(this.lockPath);
        }
      } catch {
        // Best effort — if we can't read it, try to remove it
        try { fs.unlinkSync(this.lockPath); } catch { /* ignore */ }
      }
    }
    this.hasLock = false;
  }

  /**
   * Start a new session or load existing one.
   * Layer 2: With lock acquisition.
   */
  startOrLoad(sessionId) {
    this.ensureDir();

    // Try to acquire lock
    const gotLock = this.acquireLock();
    if (!gotLock) {
      // Another session is active — load read-only
      if (fs.existsSync(this.activeSessionPath)) {
        try {
          const content = fs.readFileSync(this.activeSessionPath, 'utf8');
          this.state = JSON.parse(content);
          return { action: 'loaded_readonly', session_id: this.state.session_id, locked: true };
        } catch {
          // Fall through to create
        }
      }
    }

    if (fs.existsSync(this.activeSessionPath)) {
      try {
        const content = fs.readFileSync(this.activeSessionPath, 'utf8');
        this.state = JSON.parse(content);
        return { action: 'loaded', session_id: this.state.session_id };
      } catch {
        // Corrupted file — start fresh
      }
    }

    this.state = createSessionState(sessionId);
    this.save();
    return { action: 'created', session_id: sessionId };
  }

  /**
   * Save current state to disk.
   */
  save() {
    this.ensureDir();
    fs.writeFileSync(
      this.activeSessionPath,
      JSON.stringify(this.state, null, 2) + '\n',
      'utf8'
    );
  }

  /**
   * Record a gate evaluation result.
   */
  recordGate(gateResult) {
    if (!this.state) return;

    this.state.gate_history.push({
      gate: gateResult.gate_name,
      verdict: gateResult.verdict,
      timestamp: gateResult.timestamp,
      evidence: typeof gateResult.evidence === 'string'
        ? gateResult.evidence
        : JSON.stringify(gateResult.evidence),
      evaluator_type: gateResult.evaluator_type,
    });

    // Remove from pending if present
    const idx = this.state.pending_gates.indexOf(gateResult.gate_name);
    if (idx !== -1) {
      this.state.pending_gates.splice(idx, 1);
    }

    this.save();
  }

  /**
   * Set the active flow and phase.
   */
  setActiveFlow(flowName, phase) {
    if (!this.state) return;
    this.state.active_flow = flowName;
    this.state.current_phase = phase || null;
    this.save();
  }

  /**
   * Set pending gates for the current phase.
   */
  setPendingGates(gateNames) {
    if (!this.state) return;
    this.state.pending_gates = gateNames;
    this.save();
  }

  /**
   * Advance to next phase.
   */
  advancePhase(phaseName) {
    if (!this.state) return;
    this.state.current_phase = phaseName;
    this.save();
  }

  /**
   * Update context pressure estimate.
   */
  updateContextPressure(tokenEstimate) {
    if (!this.state) return;
    this.state.token_estimate = tokenEstimate;

    if (tokenEstimate < 50000) {
      this.state.context_pressure = 'low';
    } else if (tokenEstimate < 70000) {
      this.state.context_pressure = 'medium';
    } else if (tokenEstimate < 85000) {
      this.state.context_pressure = 'high';
    } else {
      this.state.context_pressure = 'critical';
    }

    this.save();
  }

  /**
   * Get summary of gate results for the current session.
   */
  getGateSummary() {
    if (!this.state) return { pass: 0, warn: 0, block: 0, total: 0 };
    const history = this.state.gate_history;
    return {
      pass: history.filter(g => g.verdict === 'PASS').length,
      warn: history.filter(g => g.verdict === 'WARN').length,
      block: history.filter(g => g.verdict === 'BLOCK').length,
      total: history.length,
    };
  }

  /**
   * Check if a specific gate has already passed in this session.
   */
  hasGatePassed(gateName) {
    if (!this.state) return false;
    return this.state.gate_history.some(
      g => g.gate === gateName && g.verdict === 'PASS'
    );
  }

  /**
   * End the session, writing a completion record.
   * Layer 2: Release lock and write gate summary to archive.
   */
  endSession() {
    if (!this.state) return;
    this.state.ended_at = new Date().toISOString();

    // Layer 2: Add gate summary to archive for cross-session learning
    this.state.final_gate_summary = this.getGateSummary();

    this.save();

    // Archive to timestamped file
    const archiveName = `session-${this.state.session_id}.json`;
    const archivePath = path.join(this.sessionsDir, archiveName);
    fs.copyFileSync(this.activeSessionPath, archivePath);

    // Layer 2: Release lock
    this.releaseLock();

    this.state = null;
  }

  /**
   * Get current state (read-only copy).
   */
  getState() {
    return this.state ? { ...this.state } : null;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  SessionManager,
  createSessionState,
};
