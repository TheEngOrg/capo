// src/repl/SubprocessController.ts
//
// M3: Controller for the active LLM subprocess handle.
// Allows Ctrl+C handler to SIGTERM the in-flight claude subprocess.

export interface ChildHandle {
  pid?: number;
  kill: (signal?: string) => boolean;
}

export interface SubprocessController {
  setActiveProcess(child: ChildHandle | null): void;
  getActiveProcess(): ChildHandle | null;
  /** Send SIGTERM to active child if one exists, then clear the ref. No-op if none. */
  cancel(): void;
}

export function createSubprocessController(): SubprocessController {
  let activeProcess: ChildHandle | null = null;

  return {
    setActiveProcess(child: ChildHandle | null): void {
      activeProcess = child;
    },

    getActiveProcess(): ChildHandle | null {
      return activeProcess;
    },

    cancel(): void {
      if (activeProcess !== null) {
        activeProcess.kill('SIGTERM');
        activeProcess = null;
      }
    },
  };
}
