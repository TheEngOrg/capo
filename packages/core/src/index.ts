/**
 * @teo/core — TEO core runtime
 *
 * Public API barrel. Consumers import from '@teo/core' only.
 * Direct imports from '@teo/core/internal/*' are blocked by the
 * ESLint no-restricted-imports rule in CI.
 *
 * This file is the contract. Interfaces declared here are stable
 * within a minor version. Internal module layout may change.
 *
 * Population happens in Step 0 (greenfield-interfaces ADR) +
 * Weeks 1-3 of the v1 plan.
 */

export const TEO_CORE_VERSION = '1.0.0-pre.0';
