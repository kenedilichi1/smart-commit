// =============================================================================
// COMMIT MESSAGE PARSING
// =============================================================================
// Turns raw LLM output into a { head, body } pair, and turns that pair into
// the argv for `git commit`. Deliberately separate from prompts/commit.ts:
// that file only builds prompt strings, this file only interprets responses.
// It imports the contract constants (BODY_SENTINEL, CC_REGEX) from the prompt
// file so "what we asked for" and "what we parse" stay in lockstep.
// =============================================================================

import { BODY_SENTINEL, CC_REGEX } from "../prompts/commit.js";

export interface ParsedCommitMessage {
  head: string;
  body: string;
  /** true if CC_REGEX matched the head line as-is */
  headValid: boolean;
}

/**
 * Splits raw model output on the BODY_SENTINEL and cleans up both halves.
 * Tolerant of the small model occasionally wrapping output in code fences
 * or adding stray blank lines, since those are the most common failure
 * modes observed with quantized 1.5B models.
 */
export function parseCommitMessage(raw: string): ParsedCommitMessage {
  const cleaned = raw
    .trim()
    // strip accidental code fences
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```$/i, "")
    .trim();

  const sentinelIndex = cleaned.indexOf(BODY_SENTINEL);

  let headRaw: string;
  let bodyRaw: string;

  if (sentinelIndex === -1) {
    // Model dropped the sentinel — fall back to "first line is head,
    // rest is body" so we still produce something usable.
    const [firstLine, ...rest] = cleaned.split("\n");
    headRaw = firstLine ?? "";
    bodyRaw = rest.join("\n");
  } else {
    headRaw = cleaned.slice(0, sentinelIndex);
    bodyRaw = cleaned.slice(sentinelIndex + BODY_SENTINEL.length);
  }

  const head = headRaw.trim();

  const MAX_BULLETS = 8;
  const rawLines = bodyRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // normalize to "- " bullets even if the model used "*" or forgot the dash
    .map((line) =>
      line.startsWith("-") ? line : `- ${line.replace(/^[*•]\s*/, "")}`,
    );

  // Defensive backstop against degenerate loops (a known failure mode for
  // small quantized models when EOS detection fails and generation runs to
  // maxTokens): stop accepting bullets the instant one repeats, since
  // everything from that point on is the same cycle repeating, not signal.
  const bullets: string[] = [];
  const seen = new Set<string>();
  for (const line of rawLines) {
    const key = line.toLowerCase();
    if (seen.has(key)) break;
    seen.add(key);
    bullets.push(line);
    if (bullets.length >= MAX_BULLETS) break;
  }

  const body = bullets.join("\n");

  return {
    head,
    body,
    headValid: CC_REGEX.test(head),
  };
}

/**
 * Builds the argv array for a `git commit` invocation matching:
 *   git commit -m "head" -m "body in bullet point format"
 * If body is empty, only the head -m is included (git treats a second
 * empty -m as an unwanted blank paragraph, so we skip it entirely).
 */
export function buildGitCommitArgs(parsed: ParsedCommitMessage): string[] {
  const args = ["commit", "-m", parsed.head];
  if (parsed.body.length > 0) {
    args.push("-m", parsed.body);
  }
  return args;
}
