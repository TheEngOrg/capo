// src/mechanical/errors.ts
//
// M3: ToolGrantViolation error class for mechanical pipeline allowlist enforcement.

export class ToolGrantViolation extends Error {
  readonly operation: string;

  constructor(message: string, operation?: string) {
    super(message);
    this.name = 'ToolGrantViolation';
    this.operation = operation ?? 'unknown';
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ToolGrantViolation.prototype);
  }
}
