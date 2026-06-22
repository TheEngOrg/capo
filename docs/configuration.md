# Configuration

CAPO loads its agents, skills, and hooks from the plugin cache. Your project directory is never touched by default. This page covers how to extend or override the defaults.

## Adding custom agents

Place a `.md` file in your project's `.claude/agents/` directory:

```
your-project/
  .claude/
    agents/
      my-custom-agent.md   <-- your agent
```

Claude Code loads agents from all sources — plugin and project-local — at the same time. They coexist without conflict as long as their names don't collide.

Agent files use YAML frontmatter followed by the agent's instructions:

```markdown
---
name: my-custom-agent
description: Does a specific thing for this project
---

Your agent instructions here.
```

## Overriding a built-in agent

If you want to replace a CAPO agent with your own version, create an agent file with the same name in your project's `.claude/agents/` directory. The project-local file takes precedence.

For example, to override the `dev` agent:

```
your-project/
  .claude/
    agents/
      dev.md   <-- your version wins
```

Only override when you have a project-specific reason. Most customization is better done by adding a new agent and having Capo delegate to it.

## Adding custom skills

Place a skill directory (containing a `SKILL.md`) in your project's `.claude/skills/`:

```
your-project/
  .claude/
    skills/
      my-skill/
        SKILL.md
```

Custom skills are available alongside CAPO's built-in skills. There's no registration step — Claude Code picks them up automatically.

## Hooks

CAPO ships 9 hook scripts in `.claude/hooks/`. Seven of them have active entries in `hooks/hooks.json`:

| Event | Script | What it does |
|-------|--------|--------------|
| SessionStart | `session-start.sh` | Prints version info |
| SessionStart | `sage-activation.sh` | Loads the Capo/orchestrator persona |
| SessionStart | `teo-session-start-meta.sh` | Stub — exits 0, no-op |
| PreToolUse/Bash | `block-no-verify.sh` | Blocks `--no-verify` and signing-bypass flags in git commands |
| PostToolUse | `post-tool-use.sh` | Stub — exits 0, no-op |
| TaskCompleted | `task-completed.sh` | Stub — exits 0, no-op |
| TeammateIdle | `teammate-idle.sh` | Stub — exits 0, no-op |

The three stub hooks are placeholders for future functionality. They do nothing now.

To add your own hooks, add them to your project's `.claude/hooks/` directory and register them in a local `hooks.json`. Project hooks run alongside plugin hooks.

## The escape hatch

Prefix any message with `!` at column 0 to route it directly to the main Claude Code session, bypassing Capo's routing entirely:

```
! what does the session-start hook do
!explain the CAD pipeline
```

The `!` is stripped before processing. Hooks still run — the escape hatch only bypasses Capo's orchestration. It does not persist; the next message routes normally.

Note: leading whitespace before `!` does not trigger the escape hatch. It must be the first character on the line.
