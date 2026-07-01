import { describe, it, expect } from "vitest";
import { CC_REGEX, getUserPrompt, getSystemPrompt } from "./commit.js";

// Shared test fixtures
const SAMPLE_DIFF = "diff --git a/src/foo.ts b/src/foo.ts\n+const x = 1;";
const SAMPLE_BRANCH = "feature/user-auth";
const SAMPLE_COMMITS = [
  "a1b2c3d feat(api): add registration endpoint",
  "e4f5g6h fix(auth): handle expired tokens",
];

// ---------------------------------------------------------------------------
// CC_REGEX — Conventional Commits format validator
// ---------------------------------------------------------------------------

describe("CC_REGEX", () => {
  const validMessages = [
    "feat(auth): add login endpoint",
    "fix(parser): correct off-by-one error",
    "docs(readme): update installation steps",
    "refactor: simplify config loader",
    "chore(deps): bump vitest to v4",
    "build(ci): add GitHub Actions workflow",
    "revert: revert feat(auth): add login endpoint",
    "perf(db): reduce query count on user fetch",
    "style(lint): fix trailing whitespace",
    "test(git): add tests for getStagedDiff",
    "ci: fix pnpm cache key",
  ];

  const invalidMessages = [
    "",
    "add login endpoint",              // missing type
    "feat add login",                  // missing colon
    "feat(): add something",           // empty scope
    "FEAT(auth): add login",           // uppercase type
    "feat(auth): ",                    // empty description
    "random text without format",
    "feat(auth):no space after colon",
  ];

  it.each(validMessages)("accepts valid message: %s", (msg) => {
    expect(CC_REGEX.test(msg)).toBe(true);
  });

  it.each(invalidMessages)("rejects invalid message: %s", (msg) => {
    expect(CC_REGEX.test(msg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getUserPrompt — context injection and diff truncation
// ---------------------------------------------------------------------------

describe("getUserPrompt", () => {
  it("includes the branch name in the prompt", () => {
    const prompt = getUserPrompt(SAMPLE_DIFF, SAMPLE_BRANCH, SAMPLE_COMMITS);
    expect(prompt).toContain(`BRANCH: ${SAMPLE_BRANCH}`);
  });

  it("includes each recent commit in the prompt", () => {
    const prompt = getUserPrompt(SAMPLE_DIFF, SAMPLE_BRANCH, SAMPLE_COMMITS);
    for (const commit of SAMPLE_COMMITS) {
      expect(prompt).toContain(commit);
    }
  });

  it("shows a no-history placeholder when recentCommits is empty", () => {
    const prompt = getUserPrompt(SAMPLE_DIFF, "main", []);
    expect(prompt).toContain("no prior commits");
  });

  it("includes the diff verbatim when it is under the 10,000 char limit", () => {
    const prompt = getUserPrompt(SAMPLE_DIFF, SAMPLE_BRANCH, SAMPLE_COMMITS);
    expect(prompt).toContain(SAMPLE_DIFF);
    expect(prompt).not.toContain("[DIFF TRUNCATED]");
  });

  it("truncates the diff and appends a marker when it exceeds 10,000 chars", () => {
    const hugeDiff = "x".repeat(15_000);
    const prompt = getUserPrompt(hugeDiff, SAMPLE_BRANCH, SAMPLE_COMMITS);
    expect(prompt).toContain("[DIFF TRUNCATED]");
    // Confirm overall prompt is shorter than it would be without truncation
    const diffSection = prompt.split("DIFF:\n")[1] ?? "";
    expect(diffSection.length).toBeLessThan(hugeDiff.length);
  });

  it("truncates at exactly 10,001 characters (boundary)", () => {
    const diff = "a".repeat(10_001);
    const prompt = getUserPrompt(diff, "main", []);
    expect(prompt).toContain("[DIFF TRUNCATED]");
  });

  it("does not truncate a diff of exactly 10,000 chars", () => {
    const diff = "a".repeat(10_000);
    const prompt = getUserPrompt(diff, "main", []);
    expect(prompt).not.toContain("[DIFF TRUNCATED]");
  });

  it("ends with 'OUTPUT:' to anchor the model response correctly", () => {
    const prompt = getUserPrompt(SAMPLE_DIFF, SAMPLE_BRANCH, SAMPLE_COMMITS);
    expect(prompt.trim().endsWith("OUTPUT:")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getSystemPrompt — structure sanity checks
// ---------------------------------------------------------------------------

describe("getSystemPrompt", () => {
  it("includes all required Conventional Commit types", () => {
    const prompt = getSystemPrompt();
    const requiredTypes = [
      "feat", "fix", "refactor", "perf", "docs",
      "style", "test", "chore", "build", "ci", "revert",
    ];
    for (const type of requiredTypes) {
      expect(prompt).toContain(type);
    }
  });

  it("includes few-shot examples with BRANCH, RECENT COMMITS, DIFF, and OUTPUT sections", () => {
    const prompt = getSystemPrompt();
    expect(prompt).toContain("BRANCH:");
    expect(prompt).toContain("RECENT COMMITS:");
    expect(prompt).toContain("DIFF:");
    expect(prompt).toContain("OUTPUT:");
  });

  it("instructs the model to output nothing except the commit line", () => {
    const prompt = getSystemPrompt();
    expect(prompt.toLowerCase()).toContain("no extra commentary");
  });

  it("includes branch-based scope inference rule", () => {
    const prompt = getSystemPrompt();
    expect(prompt).toContain("branch name");
  });
});
