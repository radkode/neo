---
"@radkode/neo": minor
---

Add AI-powered commit message generation with `neo git commit --ai`

- Generates conventional commit messages using Claude API (claude-3-haiku)
- Analyzes staged diff and repository context (recent commits, branch name)
- Shows preview with options to commit, edit in wizard, regenerate, or cancel
- Requires ANTHROPIC_API_KEY environment variable
