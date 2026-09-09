# Backend build status

This index tracks the provider integration added after the v2 Effect RPC backend.
The retired v1 planning checklist is not restored.

- [x] Compare the installed Codex and Grok CLIs against T3 Code's adapters.
- [x] Add an opt-in, scoped Codex app-server adapter with persistent resume,
      streaming, tool events, approvals, questions, steering, and interruption.
- [x] Preserve Claude/echo selection and Claude's stored session pointers.
- [x] Test fixtures, migration/reopen, backend RPC, and live Codex tool use/resume.
- [ ] Jett's morning review of the [rationale and walkthrough](chunks/codex-provider.md).
- [ ] Frontend integration and provider selection UI (outside this task).

The branch is based on `origin/jetty-v2`; no merge is authorized.
