// =============================================================================
// COMMIT MESSAGE PROMPT TEMPLATE
// =============================================================================
// Edit this file to tune what the AI model is instructed to produce.
// =============================================================================

const SYSTEM_INSTRUCTION = `\
You are a git commit message generator. Your ONLY output must be a single \
commit message line in Conventional Commits format. Output nothing else — \
no explanation, no markdown, no quotes, no punctuation at the end.`;

const FORMAT_SPEC = `\
FORMAT: <type>(<scope>): <description>

TYPES: feat | fix | refactor | perf | docs | style | test | chore | build | ci | revert
SCOPE: the module, file, or area changed (optional but preferred)
DESCRIPTION: imperative mood, lowercase, max 72 chars total`;

const RULES = `\
RULES:
- Use imperative mood: "add" not "added", "fix" not "fixed"
- Scope should be the primary file or module name without extension
- If multiple files changed, pick the most significant scope
- Output EXACTLY one line. No newlines.`;

// -----------------------------------------------------------------------------
// Few-shot examples — add more here to improve accuracy on your codebase.
// Each entry is a { diff, message } pair shown verbatim to the model.
// Keep these generic: avoid referencing files from this repo so examples
// don't silently drift as the codebase evolves.
// -----------------------------------------------------------------------------
const EXAMPLES: Array<{ diff: string; message: string }> = [
  {
    diff: `diff --git a/src/auth/login.ts
+export async function loginUser(email: string, password: string) {}`,
    message: "feat(auth): add loginUser function with email and password support",
  },
  {
    diff: `diff --git a/src/lib/parser.ts
-  if (i < arr.length) {
+  if (i <= arr.length) {`,
    message: "fix(parser): correct off-by-one error in array bounds check",
  },
  {
    diff: `diff --git a/README.md
+## Installation\nnpm install my-tool -g`,
    message: "docs(readme): add global installation instructions",
  },
  {
    diff: `diff --git a/src/config/paths.ts
-const DATA_DIR = path.join(process.cwd(), "data");
+const DATA_DIR = path.join(os.homedir(), ".my-tool", "data");`,
    message: "fix(paths): resolve data directory relative to home for global installs",
  },
  {
    diff: `diff --git a/package.json
+"scripts": { "build": "tsc", "test": "vitest" }`,
    message: "build(config): add build and test scripts to package.json",
  },
];

/**
 * Regex for validating Conventional Commits format.
 * Exported so the AI worker can validate the model's raw output before
 * sending it back to the parent process.
 */
export const CC_REGEX =
  /^(feat|fix|refactor|perf|docs|style|test|chore|build|ci|revert)(\(.+\))?: .+/;

export function getSystemPrompt(): string {
  const examplesBlock = EXAMPLES.map(
    (ex) => `DIFF:\n${ex.diff}\nOUTPUT: ${ex.message}`,
  ).join("\n\n");

  return [
    SYSTEM_INSTRUCTION,
    "",
    FORMAT_SPEC,
    "",
    RULES,
    "",
    "EXAMPLES (study these carefully):",
    "",
    examplesBlock,
  ].join("\n");
}

export function getUserPrompt(diff: string): string {
  // Truncate the diff so we don't blow out the model's context window.
  // 10,000 characters is roughly 2,500 tokens, which fits comfortably
  // inside our 4096 context size along with the system prompt.
  const MAX_CHARS = 10_000;
  const truncatedDiff =
    diff.length > MAX_CHARS
      ? diff.slice(0, MAX_CHARS) + "\n... [DIFF TRUNCATED]"
      : diff;

  return [
    "Now analyze the following diff and output ONLY the commit message in the correct format:",
    "",
    "DIFF:",
    truncatedDiff,
    "OUTPUT:",
  ].join("\n");
}
