import { execSync, execFileSync } from "node:child_process";

/**
 * Plumbing check to ensure the tool is executing inside a live Git repository
 */
export function isGitRepository() {
  try {
    const result = execSync("git rev-parse --is-inside-work-tree", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return result.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Plumbing check to see if there are staged changes ready to commit.
 * Reads the staging index directly. Works on brand new and old repositories alike.
 * @returns {boolean}
 */
export function hasStagedChanges() {
  try {
    const output = execSync("git diff --cached --name-only", {
      encoding: "utf8",
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Gets the raw diff of all staged changes, excluding lock files, build
 * artefacts, and generated directories to keep the AI context focused.
 * Uses execFileSync with an args array — no shell involved, no quoting needed.
 * @returns {string}
 */
export function getStagedDiff() {
  try {
    const diff = execFileSync(
      "git",
      [
        "diff",
        "--cached",
        "--",
        ".",
        ":(exclude)pnpm-lock.yaml",
        ":(exclude)package-lock.json",
        ":(exclude)yarn.lock",
        ":(exclude)dist/*",
        ":(exclude)**/node_modules/**",
        ":(exclude)models/*",
      ],
      { encoding: "utf8" },
    );
    return diff.trim();
  } catch {
    throw new Error("Failed to read Git staged index pipeline.");
  }
}

/**
 * Executes the final commit.
 * Uses execFileSync with an args array to bypass the shell entirely,
 * preventing any shell-injection via the commit message content.
 */
export function executeCommit(message: string) {
  try {
    execFileSync("git", ["commit", "-m", message], { stdio: "inherit" });
    return true;
  } catch {
    throw new Error("Failed to finalize Git commit object.");
  }
}
