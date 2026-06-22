# Contributing

We're glad you want to contribute. Here's what you need to know.

## Get the code

```
git clone https://github.com/TheEngOrg/capo.git
cd capo
npm install
```

## Run the tests

```
npm test
```

All tests must pass before submitting a PR. We won't merge red CI.

## How we build things

CAPO follows the CAD pipeline (qa-spec → dev → qa-validate → staff-engineer review → commit) for all substantive changes. In practice, that means:

- **QA writes tests first** — failing tests exist before any implementation starts. Tests cover misuse and boundary cases before the golden path.
- **Dev implements to green** — minimum code to pass the tests.
- **Staff engineer reviews** — architecture and quality review before anything merges.

If you're contributing a feature, open an issue first so we can align on scope. Small bug fixes and doc improvements can go straight to a PR.

## Bug reports

Open a [GitHub Issue](https://github.com/TheEngOrg/capo/issues) with:
- What you expected to happen
- What actually happened
- The `/teo` command or message you ran
- Any error output from the session

## What's in scope

- New agents — place a `.md` file in `.claude/agents/`, follow the existing frontmatter format
- New skills — place a skill directory in `.claude/skills/` with a `SKILL.md`
- Hook improvements — scripts live in `.claude/hooks/`, registered in `hooks/hooks.json`
- Core orchestration logic — in `src/`
- Docs — in `docs/`

## Code style

- TypeScript for anything in `src/`
- Shell scripts for hooks (POSIX-compatible)
- No new dependencies without a discussion in the issue first

## License

By contributing, you agree that your contributions will be licensed under the MIT license that covers this project.
