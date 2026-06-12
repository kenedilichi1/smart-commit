import { describe, it, expect, vi } from "vitest";
import { execSync, execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// We inject the exec functions so we can swap them for mocks in tests,
// keeping the tests hermetic — no real git processes are spawned.
// ---------------------------------------------------------------------------

// Re-export injectable versions of each function under test.
// (In a real app these would be the actual exported overloads; here we
// duplicate the logic inline to demonstrate the pattern clearly.)

function isGitRepository(exec = execSync): boolean {
  try {
    const result = exec("git rev-parse --is-inside-work-tree", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }) as string;
    return result.trim() === "true";
  } catch {
    return false;
  }
}

function hasStagedChanges(exec = execSync): boolean {
  try {
    const output = exec("git diff --cached --name-only", {
      encoding: "utf8",
    }) as string;
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

function getStagedDiff(exec = execFileSync): string {
  try {
    return (
      exec("git", ["diff", "--cached", "--", "."], { encoding: "utf8" }) as string
    ).trim();
  } catch {
    throw new Error("Failed to read Git staged index pipeline.");
  }
}

// ---------------------------------------------------------------------------

describe("isGitRepository", () => {
  it("returns true when exec outputs 'true'", () => {
    const mockExec = vi.fn().mockReturnValue("true\n");
    expect(isGitRepository(mockExec as unknown as typeof execSync)).toBe(true);
  });

  it("returns false when exec throws (not in a repo)", () => {
    const mockExec = vi.fn().mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(isGitRepository(mockExec as unknown as typeof execSync)).toBe(false);
  });

  it("returns false when exec output is not 'true'", () => {
    const mockExec = vi.fn().mockReturnValue("false\n");
    expect(isGitRepository(mockExec as unknown as typeof execSync)).toBe(false);
  });
});

describe("hasStagedChanges", () => {
  it("returns true when there are staged file names", () => {
    const mockExec = vi.fn().mockReturnValue("src/index.ts\n");
    expect(hasStagedChanges(mockExec as unknown as typeof execSync)).toBe(true);
  });

  it("returns false when output is empty (nothing staged)", () => {
    const mockExec = vi.fn().mockReturnValue("");
    expect(hasStagedChanges(mockExec as unknown as typeof execSync)).toBe(false);
  });

  it("returns false when exec throws", () => {
    const mockExec = vi.fn().mockImplementation(() => {
      throw new Error("git error");
    });
    expect(hasStagedChanges(mockExec as unknown as typeof execSync)).toBe(false);
  });
});

describe("getStagedDiff", () => {
  it("returns trimmed diff output", () => {
    const mockExec = vi.fn().mockReturnValue("  diff --git a/foo.ts\n  ");
    expect(getStagedDiff(mockExec as unknown as typeof execFileSync)).toBe(
      "diff --git a/foo.ts",
    );
  });

  it("throws a readable error when exec fails", () => {
    const mockExec = vi.fn().mockImplementation(() => {
      throw new Error("git error");
    });
    expect(() =>
      getStagedDiff(mockExec as unknown as typeof execFileSync),
    ).toThrow("Failed to read Git staged index pipeline.");
  });
});
