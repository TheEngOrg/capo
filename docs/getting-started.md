# Getting Started

## Install

TEO ships as a Claude Code plugin from its own marketplace. In any Claude Code session:

```
/plugin marketplace add TheEngOrg/the-eng-org
/plugin install teo@teo-marketplace
```

That registers the marketplace and installs the plugin into your user scope. The plugin's agents, skills, and hooks load from the plugin cache — nothing is written into your project.

To confirm it loaded, run `/teo` with no arguments. You should see the menu.

## First run

Start with the menu:

```
/teo
```

Then hand Capo a piece of work. For a bounded change:

```
/teo build add a --dry-run flag to the export command
```

Capo classifies the request, scopes it, and runs the pipeline: QA writes failing tests, dev implements to green, a staff engineer reviews, and Capo commits once the gates pass. You're asked for input only when there's a real decision — an architectural fork, an unresolved trade-off, or a risk worth surfacing.

For an open question instead of a task:

```
/teo how should we structure the plan schema for parallel workstreams?
```

Capo routes it to the right specialist and surfaces their answer.

## The menu

| Command | What it does |
|---------|--------------|
| `/teo build <feature>` | Full development cycle — QA → dev → review → commit |
| `/teo fix <bug>` | Reproduce, fix, verify |
| `/teo review <scope>` | Quality and security review of existing work |
| `/teo plan <initiative>` | Scope and sequence new work before building |
| `/teo improve <scope>` | Refactor with characterization tests |
| `/teo ship <deliverable>` | Docs, copy, design assets |
| `/teo <anything>` | Ask Capo to orchestrate whatever you describe |

## Uninstall

```
/plugin uninstall teo@teo-marketplace
/plugin marketplace remove teo-marketplace
```

Both steps fully remove TEO. Because the plugin never wrote into your project, there's nothing to clean up in your repo.
