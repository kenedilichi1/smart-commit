// =============================================================================
// COMMIT MESSAGE PROMPT TEMPLATE
// =============================================================================
// Edit this file to tune what the AI model is instructed to produce.
// All three context signals (diff, branch, recent commits) flow through here.
// =============================================================================

const SYSTEM_INSTRUCTION = `\
You are an expert git commit message generator. Your ONLY output must be a \
valid commit message in Conventional Commits format. Output nothing else — \
no explanation, no markdown, no quotes.`;

const FORMAT_SPEC = `\
FORMAT: 
<type>(<scope>): <description>

[optional body]

TYPES: feat | fix | refactor | perf | docs | style | test | chore | build | ci | revert
SCOPE: the module, file, or area changed (optional but preferred)
DESCRIPTION: imperative mood, lowercase, max 72 chars total
BODY: detailed explanation of what changed and why. Use bullet points for multiple changes. Wrap at 72 chars.`;

const RULES = `\
RULES:
- Use imperative mood: "add" not "added", "fix" not "fixed"
- Infer scope from the branch name when it contains a meaningful segment
  e.g. "feature/user-auth" → scope "auth", "fix/api-timeout" → scope "api"
- If recent commits follow a consistent scope naming pattern, match it
- If multiple files changed, pick the most semantically significant scope
- Add a body if the diff is complex and requires explanation. Skip the body for trivial changes.
- Output EXACTLY the commit message. No markdown code blocks surrounding it.`;

// -----------------------------------------------------------------------------
// Few-shot examples — add more here to improve accuracy on your codebase.
// Each entry is a { diff, branch, recentCommits, message } tuple shown to the
// model verbatim. Keep these generic so they don't drift as the project evolves.
// -----------------------------------------------------------------------------
const EXAMPLES: Array<{
  branch: string;
  recentCommits: string[];
  diff: string;
  message: string;
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
    message: "feat(auth): add loginUser function with credential validation\n\n- Validates email and password against db\n- Compares password hash using bcrypt\n- Returns JWT token on success",
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
    message: "fix(parser): correct off-by-one error in array bounds check",
  },
  {
    branch: "docs/update-readme",
    recentCommits: ["d4e5f6g chore: bump version to 2.1.0"],
    diff: `diff --git a/README.md b/README.md
+## Installation
+\`\`\`bash
+npm install my-tool -g
+\`\`\``,
    message: "docs(readme): add global installation instructions",
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
    message: "fix(paths): resolve data dir relative to home for global installs",
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
    message: "ci: add GitHub Actions workflow for build and test",
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
    message: "perf(db): replace N+1 queries with single JOIN on user fetch",
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
  const examplesBlock = EXAMPLES.map((ex) => {
    const commitsBlock =
      ex.recentCommits.length > 0
        ? ex.recentCommits.map((c) => `  ${c}`).join("\n")
        : "  (no prior commits)";
    return [
      `BRANCH: ${ex.branch}`,
      `RECENT COMMITS:\n${commitsBlock}`,
      `DIFF:\n${ex.diff}`,
      `OUTPUT: ${ex.message}`,
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
    "Analyze the context below and output ONLY the commit message:",
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
