# CLAUDE

## Telegram Control (telegram-me)

When telegram-me MCP tools are available, this project is controlled via Telegram by default.

### Auto-start

1. Create flag: `touch /tmp/telegram-me-autonomous.flag`
2. Check for `~/.telegram-me/resume/{project}.json` — if found, read saved context, delete file, notify "Resuming from rate-limited session", ask "Continue with this task?" with `["Yes, continue", "New task"]`
3. Call `get_user_message` for buffered messages
4. Notify: "Autonomous mode active."
5. Enter autonomous loop

### Autonomous Loop

1. Wait for instructions via `ask_user`
2. Check if message starts with `[BTW]` — if so, answer briefly via `notify_user` and continue current task (don't treat as new instruction)
3. Execute (permissions auto-approved via hook)
4. Verify tests if code modified — fix failures before proceeding
5. Report results via `notify_user`
6. **Smart Suggester**: analyze project state silently and present 2-4 concrete next steps as `ask_user` options (see details below)
7. Loop back. Exit on `/stop` or `/exit`

### Key Rules

- **Always include `options`**: Every `ask_user` call MUST include the `options` parameter (2-4 choices). Without it, reply keyboard buttons don't appear.
- **Always acknowledge messages** in TWO places: terminal output ("**Telegram message received:** {message}") AND Telegram (`notify_user`)
- **File changes after plan approval**: execute without per-file confirmations. Only ask for unplanned changes.
- **NEVER use \`EnterPlanMode\` or \`ExitPlanMode\`** — they block autonomous mode. Use \`approve_plan\` tool instead.
- **Exiting**: delete flag `rm -f /tmp/telegram-me-autonomous.flag`, notify "Autonomous mode ended."

### Planning via Telegram

1. Explore codebase, design approach
2. Send plan via `approve_plan` (auto-splits at 4000 chars, shows Approve/Reject/Request Changes buttons)
3. Returns `{ decision, feedback? }` — implement on approve, revise on changes requested

### Smart Suggester

After completing a task, proactively analyze the project state and suggest 2-4 concrete next steps:

1. **Git status**: uncommitted changes? Untracked files?
2. **Test health**: run tests silently. Failing tests?
3. **TODOs/FIXMEs**: search for actionable comments.
4. **Recent changes context**: suggest natural follow-ups (e.g., "added a feature → write tests")
5. **Build health**: TypeScript errors?

Prioritize: failing tests > build errors > uncommitted changes > TODOs. Keep analysis fast. Don't repeat declined suggestions. Generic fallback: `["Check project status", "Run tests", "Review recent changes", "Something else"]`

### Commands

| Command | Action |
|---------|--------|
| `/stop` `/exit` | Exit autonomous mode |
| `/status` | Report current activity |
| `/model` | Pick AI model per project (server-side, zero tokens) |
| `/compact` | Remind user to run in terminal |
| `/help` | List commands |
| `/review` | Cross-bot code review (`request_review` tool) |
| `/design <brief>` | Specialist designer agent (`request_specialist` tool) |
| `/security_review [ref]` | Cross-bot security audit (`request_specialist` tool) |
| `/refine <prompt>` | Transform rough prompt into well-crafted instruction |
| `/cron` | Manage session tasks and daemon cron tasks |
| `/self-driving [N]` | Fully autonomous improvement loop (default 3 iterations) |
| `/check` | Last 50 lines of terminal output (server-side, zero tokens) |
| `/diff [ref]` | Git diff output via Telegram/Telegraph (server-side, zero tokens) |
| `/btw <question>` | Side question — answered briefly without derailing current task |
| `/context` | Context window usage with visual bar (server-side, zero tokens) |
| `/cost` | Session token consumption stats (server-side, zero tokens) |
| `/ping` `/bots` `/dash` `/usage` `/summon` `/kill` `/restart` | Server-side (zero tokens) |

### /review

1. Generate review doc: `git diff` (or `git diff HEAD~1`), write to temp file
2. Call `request_review` with file path — blocks up to 10 min
3. Share feedback via `notify_user`
4. If no reviewer bot available, inform the user

### /design

1. Call `request_specialist(role: "designer", brief: "...")` — launches available bot
2. Designer researches Dribbble/Behance/Mobbin, creates 5 unique HTML designs, screenshots, comparison summary
3. Present results. If no brief, ask with example options. If no bot available, inform the user.

### /security_review

When the user sends `/security_review [ref]`, launch a cross-bot security audit:
1. Call `request_specialist(role: "security-reviewer", brief: ref || "HEAD")` — launches available bot
2. Reviewer runs 3-phase analysis: context research → comparative analysis → vulnerability assessment
3. Checks 6 categories: input validation, auth, crypto, injection, data exposure, config security
4. Aggressive false-positive filtering (only confidence >= 8/10)
5. Returns structured findings with severity, description, exploit scenario, recommendation
6. Share results via `notify_user` (Telegraph for long reports)
7. If no bot available, inform the user

### /refine

Transform rough instructions using these principles (apply selectively — don't over-constrain):
1. **Specificity**: Replace vague terms with concrete actions, files, and modules
2. **Decomposition**: Break complex tasks into ordered steps
3. **Success criteria**: Define what "done" looks like
4. **Scope boundaries**: Set explicit limits to prevent scope creep
5. **Context grounding**: Reference specific files/functions from the project
6. **Verification**: Include how to verify the change works

Send refined prompt via `notify_user`, present: `["Use this prompt", "Refine further", "Edit manually"]`.
Execute on "Use this prompt". Supports command chaining (e.g., `/refine /design <brief>`).
If no prompt provided, ask "What task would you like me to refine?".

### /cron

**Session-scoped** (timers in running session): `/cron in 30m "msg"`, `/cron at 14:00 "msg"`, `/cron every 1h "msg"`, `/cron list`, `/cron clear`. Use `schedule_message` with `action: 'add'`.

**Daemon-scoped** (persistent, launch new sessions): `/cron task every day at 9:00 "msg"`, `/cron task at 14:00 "msg"`, `/cron tasks`. Use `schedule_message` with `action: 'add_cron'`. `task` keyword distinguishes daemon from session scope. Project-agnostic crons (no project) auto-create `~/telegram-me-crons/` on first use.

### /self-driving

**HARD RULE: ZERO `ask_user` calls.** Only `notify_user`. YOU decide what to fix and implement. The trigger IS the approval. Self-driving replaces the normal autonomous loop. Check `get_user_message(wait=false)` between phases only for `/stop`.

1. Notify start, check resume state at `~/.telegram-me/self-driving/{project}.json`
2. Audit repo silently (build, tests, TODOs, git status). Rank by severity.
3. For each iteration (fully autonomous):
   a. Pick highest-priority issue → notify plan → proceed immediately
   b. Delegate via `request_specialist(role: 'implementer', brief: plan)`
   c. Review result: check diff for security, tests, scope creep
   d. Merge if clean, rollback if not — notify result
   e. Save state, check for `/stop`, trigger `/restart` for fresh context
4. After all iterations: notify summary, clear state, return to normal mode.
