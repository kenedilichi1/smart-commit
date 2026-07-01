// =============================================================================
// COMMIT MESSAGE PROMPT TEMPLATE
// =============================================================================
// Edit this file to tune what the AI model is instructed to produce.
// All three context signals (diff, branch, recent commits) flow through here.
//
// This file is ONLY responsible for building the prompt strings the model
// sees. It does not parse or validate model output — that lives in
// lib/commit-message.ts, which imports the contract constants (BODY_SENTINEL,
// CC_REGEX) from here so the "shape we ask for" and "shape we parse" can
// never drift apart.
// =============================================================================

/**
 * The literal line the model must emit between the head and the body.
 * Exported because lib/commit-message.ts needs the exact same string to
 * split the raw response back apart.
 */
export const BODY_SENTINEL = "===BODY===";

const SYSTEM_INSTRUCTION = `\
You are an expert git commit message generator. Your ONLY output must follow \
the exact structure below. No explanation, no markdown, no quotes, no code \
fences.`;

const FORMAT_SPEC = `\
OUTPUT STRUCTURE (exactly this shape, nothing more):

<type>(<scope>): <description>
${BODY_SENTINEL}
- <bullet 1>
- <bullet 2>
- <bullet N>

Line 1 is the HEAD. It must be a single line in Conventional Commits format.
The line "${BODY_SENTINEL}" must appear exactly once, alone on its own line,
immediately after the HEAD.
Everything after that line is the BODY, as "- " bullet points, one per line.

TYPES: feat | fix | refactor | perf | docs | style | test | chore | build | ci | revert
SCOPE: the module, file, or area changed (optional but preferred)
DESCRIPTION: imperative mood, lowercase, max 72 chars total (the whole head line)
BODY: what changed and why, one bullet per logical change. Wrap each bullet at 72 chars.

If the change is trivial (e.g. a one-line fix, a typo, a version bump), still \
output the sentinel line but leave the body empty — i.e. output nothing after \
"${BODY_SENTINEL}".`;

const RULES = `\
RULES:
- Use imperative mood: "add" not "added", "fix" not "fixed"
- Infer scope from the branch name when it contains a meaningful segment
  e.g. "feature/user-auth" → scope "auth", "fix/api-timeout" → scope "api"
- If recent commits follow a consistent scope naming pattern, match it
- If multiple files changed, pick the most semantically significant scope
- Only add body bullets if the diff is complex and requires explanation.
  Skip bullets entirely for trivial changes — but ALWAYS include the
  "${BODY_SENTINEL}" line, even with nothing after it.
- Never put the sentinel line, or any part of this structure, inside markdown
  code fences.
- Output EXACTLY the structure above. No extra commentary before or after.`;

// -----------------------------------------------------------------------------
// Few-shot examples — add more here to improve accuracy on your codebase.
// Each entry is a { diff, branch, recentCommits, head, bodyBullets } tuple
// shown to the model verbatim. Keep these generic so they don't drift as the
// project evolves.
// -----------------------------------------------------------------------------
const EXAMPLES: Array<{
  branch: string;
  recentCommits: string[];
  diff: string;
  head: string;
  bodyBullets: string[];
}> = [
  {
    branch: "feature/user-auth",
    recentCommits: [
      "a1b2c3d feat(api): add user registration endpoint",
      "e4f5g6h chore(deps): update express to 4.19.0",
    ],
    diff: `diff --git a/src/auth/login.ts b/src/auth/login.ts
+export async function loginUser(email: string, password: string) {
+  const user = await db.users.findByEmail(email);
+  if (!user || !await bcrypt.compare(password, user.hash)) throw new Error("Invalid credentials");
+  return generateToken(user.id);
+}`,
    head: "feat(auth): add loginUser function with credential validation",
    bodyBullets: [
      "Validates email and password against db",
      "Compares password hash using bcrypt",
      "Returns JWT token on success",
    ],
  },
  {
    branch: "fix/parser-bounds",
    recentCommits: [
      "b2c3d4e feat(parser): add JSON schema validation",
      "c3d4e5f test(parser): add edge case tests for empty input",
    ],
    diff: `diff --git a/src/lib/parser.ts b/src/lib/parser.ts
-  if (i < arr.length) {
+  if (i <= arr.length) {`,
    head: "fix(parser): correct off-by-one error in array bounds check",
    bodyBullets: [],
  },
  {
    branch: "docs/update-readme",
    recentCommits: ["d4e5f6g chore: bump version to 2.1.0"],
    diff: `diff --git a/README.md b/README.md
+## Installation
+\`\`\`bash
+npm install my-tool -g
+\`\`\``,
    head: "docs(readme): add global installation instructions",
    bodyBullets: [],
  },
  {
    branch: "fix/model-storage-path",
    recentCommits: [
      "e5f6g7h feat(worker): add model download progress bar",
      "f6g7h8i refactor(config): centralise path resolution",
    ],
    diff: `diff --git a/src/config/paths.ts b/src/config/paths.ts
-const DATA_DIR = path.join(process.cwd(), "data");
+const DATA_DIR = path.join(os.homedir(), ".my-tool", "data");`,
    head: "fix(paths): resolve data dir relative to home for global installs",
    bodyBullets: [
      "Previously used cwd, which broke when installed globally",
      "Now resolves against the user's home directory instead",
    ],
  },
  {
    branch: "chore/add-ci",
    recentCommits: ["g7h8i9j feat: initial project scaffold"],
    diff: `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
+name: CI
+on: [push, pull_request]
+jobs:
+  build:
+    runs-on: ubuntu-latest
+    steps:
+      - uses: actions/checkout@v4
+      - run: npm ci && npm test`,
    head: "ci: add GitHub Actions workflow for build and test",
    bodyBullets: [],
  },
  {
    branch: "perf/reduce-db-queries",
    recentCommits: [
      "h8i9j0k feat(api): add pagination to user list endpoint",
      "i9j0k1l fix(db): handle connection pool exhaustion",
    ],
    diff: `diff --git a/src/db/users.ts b/src/db/users.ts
-  const user = await db.query("SELECT * FROM users WHERE id = ?", [id]);
-  const roles = await db.query("SELECT * FROM roles WHERE user_id = ?", [id]);
+  const user = await db.query(
+    "SELECT u.*, r.name as role FROM users u LEFT JOIN roles r ON r.user_id = u.id WHERE u.id = ?",
+    [id]
+  );`,
    head: "perf(db): replace N+1 queries with single JOIN on user fetch",
    bodyBullets: [
      "Previously issued a separate query for user and roles",
      "Now fetches both in a single LEFT JOIN, cutting round trips in half",
    ],
  },
];

/**
 * Regex for validating the HEAD line's Conventional Commits format.
 * Exported so lib/commit-message.ts can validate the model's raw output.
 */
export const CC_REGEX =
  /^(feat|fix|refactor|perf|docs|style|test|chore|build|ci|revert)(\(.+\))?: .+/;

function renderExampleOutput(head: string, bodyBullets: string[]): string {
  const bodyBlock = bodyBullets.map((b) => `- ${b}`).join("\n");
  return [head, BODY_SENTINEL, bodyBlock].join("\n");
}

export function getSystemPrompt(): string {
  const examplesBlock = EXAMPLES.map((ex) => {
    const commitsBlock =
      ex.recentCommits.length > 0
        ? ex.recentCommits.map((c) => `  ${c}`).join("\n")
        : "  (no prior commits)";
    return [
      `BRANCH: ${ex.branch}`,
      `RECENT COMMITS:\n${commitsBlock}`,
      `DIFF:\n${ex.diff}`,
      `OUTPUT:\n${renderExampleOutput(ex.head, ex.bodyBullets)}`,
    ].join("\n");
  }).join("\n\n");

  return [
    SYSTEM_INSTRUCTION,
    "",
    FORMAT_SPEC,
    "",
    RULES,
    "",
    "EXAMPLES (study carefully — note how branch name and recent commits inform scope and type):",
    "",
    examplesBlock,
  ].join("\n");
}

/**
 * Builds the user-facing prompt with all three context signals:
 *   1. branch   — infer type and scope (e.g. "feature/auth" → feat, scope auth)
 *   2. recentCommits — match the project's existing commit style and scope names
 *   3. diff     — the actual code changes to describe
 *
 * The diff is truncated to ~2,500 tokens (10,000 chars) so it fits inside the
 * model's 4096-token context window alongside the system prompt.
 */
export function getUserPrompt(
  diff: string,
  branch: string,
  recentCommits: string[],
): string {
  const MAX_CHARS = 10_000;
  const truncatedDiff =
    diff.length > MAX_CHARS
      ? diff.slice(0, MAX_CHARS) + "\n... [DIFF TRUNCATED]"
      : diff;

  const commitsBlock =
    recentCommits.length > 0
      ? recentCommits.map((c) => `  ${c}`).join("\n")
      : "  (no prior commits — this may be the first commit)";

  return [
    "Analyze the context below and output ONLY the structure described in the system prompt:",
    "",
    `BRANCH: ${branch}`,
    "",
    `RECENT COMMITS:\n${commitsBlock}`,
    "",
    "DIFF:",
    truncatedDiff,
    "OUTPUT:",
  ].join("\n");
}
