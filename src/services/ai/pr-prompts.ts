import type { StructuredPrompt } from './prompts.js';

export interface AIPrRequest {
  branchName: string;
  baseBranch: string;
  commits: string[];
  diffStat: string;
  diff: string;
}

export interface AIPrResponse {
  title: string;
  body: string;
}

const MAX_DIFF_SIZE = 40000;

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_SIZE) return diff;
  return `${diff.slice(0, MAX_DIFF_SIZE)}\n\n... (diff truncated for length — ${diff.length - MAX_DIFF_SIZE} chars omitted)`;
}

const PR_SYSTEM_PROMPT = `You are a pull request description generator. Read the branch's commits and diff, then produce a PR title and body.

Rules for the title:
- Under 70 characters
- Imperative mood ("add X", "fix Y", not "adds X" or "fixed Y")
- No trailing period, no emojis, no issue numbers, no attribution
- If the repo uses conventional-commit prefixes in its history, mirror that style (e.g. "feat(cli): ..."); otherwise write a plain sentence

Rules for the body:
- Two sections: "## Summary" (1-3 bullets covering WHAT changed and WHY) and "## Test plan" (markdown checklist of concrete verification steps a reviewer could run)
- Focus on "why" — the diff already shows "what"
- Do not invent context that the commits don't support
- NEVER include attribution, co-authors, emojis, "Generated with" footers, or links back to any tool
- Use fenced backticks for inline code (commands, file names, symbols)

Respond with ONLY a JSON object in this exact format (no markdown fence, no prose):
{"title":"...","body":"## Summary\\n- ...\\n\\n## Test plan\\n- [ ] ..."}`;

export function getPrSystemPrompt(): string {
  return PR_SYSTEM_PROMPT;
}

export function buildPrPrompt(request: AIPrRequest): StructuredPrompt {
  const parts: string[] = [];

  parts.push(`Branch: ${request.branchName}`);
  parts.push(`Base: ${request.baseBranch}`);

  if (request.commits.length > 0) {
    parts.push(`\nCommits (${request.commits.length}):\n${request.commits.join('\n')}`);
  }

  if (request.diffStat) {
    parts.push(`\nFiles changed:\n${request.diffStat}`);
  }

  if (request.diff) {
    parts.push(`\nDiff:\n\`\`\`\n${truncateDiff(request.diff)}\n\`\`\``);
  }

  return {
    system: PR_SYSTEM_PROMPT,
    user: parts.join('\n'),
  };
}

export function parsePrResponse(raw: string): AIPrResponse {
  let jsonStr = raw.trim();
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) jsonStr = fence[1].trim();
  const object = jsonStr.match(/\{[\s\S]*\}/);
  if (object) jsonStr = object[0];

  const parsed = JSON.parse(jsonStr) as Partial<AIPrResponse>;
  if (!parsed.title || typeof parsed.title !== 'string') {
    throw new Error('AI response missing "title"');
  }
  if (!parsed.body || typeof parsed.body !== 'string') {
    throw new Error('AI response missing "body"');
  }

  return {
    title: parsed.title.trim(),
    body: parsed.body.trim(),
  };
}

export function isCommitListTooLarge(commits: string[], diff: string): boolean {
  return diff.length > MAX_DIFF_SIZE * 2 || commits.length > 200;
}
