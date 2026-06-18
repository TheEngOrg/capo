// This file has an unused variable at error severity — cannot be auto-fixed.
// ESLint will report an error and lint-staged will block the commit.
import { nonExistent } from "./nonexistent-module.js";
export const x = nonExistent;
