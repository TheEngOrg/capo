// =============================================================================
// host.ts — WS-GO-02: HostContext / detectHost()
//
// CONTRACT:
//   detectHost(): HostContext
//
// RULES:
//   - CLAUDE_PLUGIN_ROOT set and non-empty → kind="claude-code-plugin", pluginRoot=value
//   - CLAUDE_PLUGIN_ROOT unset or empty string → kind="standalone"
//   - CLAUDE_PLUGIN_DATA alongside CLAUDE_PLUGIN_ROOT → dataDir=value
// =============================================================================

export type HostKind = "claude-code-plugin" | "standalone";

export interface HostContext {
  kind: HostKind;
  pluginRoot?: string;
  dataDir?: string;
}

/**
 * Detect the host environment by reading CLAUDE_PLUGIN_ROOT from process.env.
 *
 * - If CLAUDE_PLUGIN_ROOT is set and non-empty → plugin context
 * - Otherwise → standalone context
 */
export function detectHost(): HostContext {
  const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];

  if (pluginRoot && pluginRoot.length > 0) {
    const dataDir = process.env["CLAUDE_PLUGIN_DATA"];
    const result: HostContext = {
      kind: "claude-code-plugin",
      pluginRoot,
    };
    if (dataDir !== undefined) {
      result.dataDir = dataDir;
    }
    return result;
  }

  return { kind: "standalone" };
}
