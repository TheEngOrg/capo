# Agents

CAPO ships 21 agents. You don't invoke these directly — Capo dispatches them based on the work. They're namespaced as `teo:<name>` so they never collide with agents you've defined in your own project.

## Roster

| Agent | Description |
|-------|-------------|
| `sage` | Orchestrator — identifies, scopes, and delegates work. Does not write code directly. This is Capo's internal agent name; the user-facing persona is "Capo". |
| `dev` | Implements features test-first. Primary implementation agent, after tests exist. |
| `dev-haiku` | Haiku-tier dev for mechanical workstreams. Faster and lower-cost; cascades to `dev` (Sonnet) after 2 failed attempts. |
| `qa` | Writes misuse-first test specs and verifies implementations. |
| `staff-engineer` | Technical leader and code reviewer. Architecture review, complex technical decisions, post-build gate. |
| `acceptance-engineer` | Advisory real-binary E2E reviewer. Owns acceptance test authorship and review at the real-subprocess layer. |
| `engineering-manager` | Manages team execution. Task coordination, progress tracking, CAD cycle coordination. |
| `engineering-director` | Oversees engineering operations and delivery. Workstream prioritization, resource allocation. |
| `cto` | Sets technical vision and architecture. Technology decisions, architectural review, technical escalations. |
| `product-manager` | Feature specs and coordination. User stories, acceptance scenarios, cross-functional alignment. |
| `product-owner` | Product vision and backlog. Feature prioritization, requirement decisions, acceptance criteria. |
| `security-engineer` | Security code reviews, vulnerability scanning, OWASP compliance, auth/authz reviews. |
| `api-designer` | API design specialist. REST/GraphQL design, OpenAPI specs, versioning strategy, request/response patterns. |
| `data-engineer` | Database and data specialist. Schema design, migrations, query optimization, data modeling, analytics. |
| `devops-engineer` | CI/CD pipelines, infrastructure as code, container/Docker, monitoring, logging. |
| `gcp-infra-specialist` | GCP infrastructure. Terraform/IaC for GCP resources, gcloud scripting, Cloud Monitoring. |
| `system-integration-specialist` | Cross-system integration. API contract design, event/message-bus schema, third-party SDK wiring. |
| `technical-writer` | Writes clear, concise documentation. README, API docs, guides, inline comments. |
| `design` | Creates UI/UX designs and implements frontend. Wireframes, mockups, component implementation. |
| `art-director` | Sets design vision and brand standards. Visual approvals, design direction, brand consistency. |
| `studio-director` | Media production orchestrator. Video, animation, SVG, audio asset pipelines. |

## Notes

- `sage` is the internal code name for the orchestrator. In all user-facing context it's referred to as "Capo".
- `dev` and `dev-haiku` are separate agents with different capability tiers. For mechanical (well-defined, low-ambiguity) workstreams, CAPO tries `dev-haiku` first for speed and cost, then escalates to `dev` if two attempts fail.
- Agents are flat `.md` files in the plugin's `agents/` directory. You can override any of them by placing a file with the same name in your project's `.claude/agents/`. See [Configuration](configuration.md) for details.
