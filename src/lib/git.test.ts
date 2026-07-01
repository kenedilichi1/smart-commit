import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the entire child_process module BEFORE importing the units under test.
// This ensures the real git binary is never invoked during test runs.
// ---------------------------------------------------------------------------
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execSync, execFileSync } from "node:child_process";
import {
  isGitRepository,
  hasStagedChanges,
  getStagedDiff,
  executeCommit,
} from "./git.js";
import type { ParsedCommitMessage } from "./commit-message.js";

// ---------------------------------------------------------------------------
// isGitRepository
// ---------------------------------------------------------------------------

describe("isGitRepository", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns true when git outputs 'true'", () => {
    vi.mocked(execSync).mockReturnValue("true\n" as never);
    expect(isGitRepository()).toBe(true);
  });

  it("returns false when git throws (not inside a repo)", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });
    expect(isGitRepository()).toBe(false);
  });

  it("returns false when git output is not 'true'", () => {
    vi.mocked(execSync).mockReturnValue("false\n" as never);
    expect(isGitRepository()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasStagedChanges
// ---------------------------------------------------------------------------

describe("hasStagedChanges", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns true when staged file names are present", () => {
    vi.mocked(execSync).mockReturnValue("src/index.ts\n" as never);
    expect(hasStagedChanges()).toBe(true);
  });

  it("returns false when output is empty (nothing staged)", () => {
    vi.mocked(execSync).mockReturnValue("" as never);
    expect(hasStagedChanges()).toBe(false);
  });

  it("returns false when git throws", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("git error");
    });
    expect(hasStagedChanges()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getStagedDiff
// ---------------------------------------------------------------------------

describe("getStagedDiff", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns trimmed diff output on success", () => {
    vi.mocked(execFileSync).mockReturnValue(
      "  diff --git a/foo.ts\n  " as never,
    );
    expect(getStagedDiff()).toBe("diff --git a/foo.ts");
  });

  it("throws a readable error when git fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("git error");
    });
    expect(() => getStagedDiff()).toThrow(
      "Failed to read Git staged index pipeline.",
    );
  });

  it("passes the correct lock-file exclusion args to git", () => {
    vi.mocked(execFileSync).mockReturnValue("" as never);
    getStagedDiff();

    const [cmd, args] = vi.mocked(execFileSync).mock.calls[0] as [
      string,
      string[],
    ];
    expect(cmd).toBe("git");
    expect(args).toContain(":(exclude)pnpm-lock.yaml");
    expect(args).toContain(":(exclude)package-lock.json");
    expect(args).toContain(":(exclude)yarn.lock");
    expect(args).toContain(":(exclude)dist/*");
  });
});

// ---------------------------------------------------------------------------
// executeCommit
// ---------------------------------------------------------------------------

describe("executeCommit", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls git commit with the message as a discrete argument (no shell injection risk)", () => {
    vi.mocked(execFileSync).mockReturnValue("" as never);
    const parsed: ParsedCommitMessage = {
      head: "feat(auth): add login",
      body: "",
      headValid: true,
    };
    executeCommit(parsed);

    const [cmd, args] = vi.mocked(execFileSync).mock.calls[0] as [
      string,
      string[],
    ];
    expect(cmd).toBe("git");
    // buildGitCommitArgs omits the body -m when body is empty
    expect(args).toEqual(["commit", "-m", "feat(auth): add login"]);
  });

  it("includes the body as a second -m argument when body is non-empty", () => {
    vi.mocked(execFileSync).mockReturnValue("" as never);
    const parsed: ParsedCommitMessage = {
      head: "feat(auth): add login",
      body: "- adds JWT-based login flow",
      headValid: true,
    };
    executeCommit(parsed);

    const [cmd, args] = vi.mocked(execFileSync).mock.calls[0] as [
      string,
      string[],
    ];
    expect(cmd).toBe("git");
    expect(args).toEqual([
      "commit",
      "-m",
      "feat(auth): add login",
      "-m",
      "- adds JWT-based login flow",
    ]);
  });

  it("throws a readable error when git commit fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("git error");
    });
    const parsed: ParsedCommitMessage = {
      head: "feat: something",
      body: "",
      headValid: true,
    };
    expect(() => executeCommit(parsed)).toThrow(
      "Failed to finalize Git commit object.",
    );
  });
});
