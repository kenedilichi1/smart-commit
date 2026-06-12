# 🤖 smart-commit

> AI-powered git commit message generator — runs **entirely on your machine**, no API keys, no cloud calls.

`smart-commit` analyses your staged diff and uses a locally-hosted LLM ([Qwen2.5-Coder-1.5B](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF)) to generate a [Conventional Commits](https://www.conventionalcommits.org/)-formatted message. You review it, approve or override it, and the commit is made — all in one command.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [How It Works](#how-it-works)
- [Model Storage](#model-storage)
- [Configuration](#configuration)
- [Customising the Prompt](#customising-the-prompt)
- [Project Structure](#project-structure)
- [Development](#development)
- [Testing](#testing)
- [Building](#building)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- 🔒 **Fully local** — inference runs on-device via [node-llama-cpp](https://github.com/withcatai/node-llama-cpp). No data ever leaves your machine.
- ⚡ **Zero config** — model is downloaded automatically on first run.
- ✅ **Conventional Commits** — output is validated against the spec before being offered to you.
- 🛡️ **Shell-injection safe** — all git operations use `execFileSync` with argument arrays, never string interpolation.
- 🧵 **Isolated inference** — the LLM runs in a forked child process, keeping the main process lightweight and responsive to Ctrl+C.
- 🔧 **Customisable** — tweak the system prompt, few-shot examples, and inference parameters in a single file.

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | **≥ 18.0** (native `fetch`, `parseArgs`, ESM) |
| Git | any modern version |
| Disk space | ~1.1 GB (model file, downloaded once) |
| RAM | ~2 GB free during inference |

> **Note:** GPU is not required. Inference runs on CPU. On a modern laptop it typically completes in 10–60 seconds depending on diff size and hardware.

---

## Installation

### Global install (recommended)

```bash
npm install -g smart-commit
# or
pnpm add -g smart-commit
```

After install, the `smart-commit` binary is available system-wide.

### From source

```bash
git clone https://github.com/your-username/smart-commit.git
cd smart-commit
pnpm install
pnpm run build
npm install -g .
```

---

## Usage

```bash
# Stage your changes first
git add src/auth/login.ts

# Run the tool
smart-commit
```

### What happens

```
========================================
           🤖 AI COMMIT CLI
========================================

🧠 Spawning isolated child process and running local AI inference...

👉 Suggested Message: "feat(auth): add loginUser function with email and password support"

Do you want to use this commit message? (Y/n):
```

- Press **Enter** or type **Y** → commits immediately with the suggested message.
- Type **n** → you are prompted to enter a custom message.
- Leave custom message **empty** and press Enter → commit is cancelled with no changes made.

### Options

```
smart-commit --help      Show help documentation
smart-commit --version   Show the installed version
```

### First run

On first run, `smart-commit` will download the ~1.1 GB model file from Hugging Face. Progress is shown inline:

```
📥 First run detected! Downloading local AI engine...
Downloading: 42.3% completed...
✅ Engine downloaded successfully and initialized!
```

Subsequent runs skip the download entirely and go straight to inference.

---

## How It Works

```
git add ...
    │
    ▼
smart-commit (main process)
    │  1. Verify git repo & staged changes
    │  2. Read staged diff (filtered — no lock files, dist, node_modules)
    │  3. Fork isolated child process
    │
    ├──► AI Worker (child process)
    │       │  4. Download model if missing
    │       │  5. Load model via node-llama-cpp (CPU, no GPU required)
    │       │  6. Build system prompt + few-shot examples
    │       │  7. Run inference (max 80 tokens, temp 0.2)
    │       │  8. Validate output against Conventional Commits regex
    │       └──► IPC: send { type: "success", message: "..." }
    │
    │  9.  Display suggested message
    │  10. Prompt: confirm or override
    │  11. git commit -m "<message>"
    ▼
Done ✓
```

### Diff filtering

The staged diff automatically excludes noise that would waste the model's context window:

| Excluded | Reason |
|---|---|
| `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` | Lock files carry no semantic intent |
| `dist/*` | Build artefacts — not authored code |
| `**/node_modules/**` | Third-party code |
| `models/*` | Binary model files |

### Output validation

The raw model response is:
1. **Stripped to the first line** — guards against multi-line hallucinations.
2. **Validated** against the Conventional Commits regex before being accepted. If it doesn't match, the worker surfaces an error and you are invited to enter a manual message instead.

---

## Model Storage

The model file is stored in a standard OS location — **not** inside the package directory — so it persists correctly across version upgrades and global installs.

| Platform | Default Path |
|---|---|
| Linux (XDG) | `$XDG_DATA_HOME/smart-commit/models/` |
| Linux (fallback) | `~/.local/share/smart-commit/models/` |
| macOS / Windows | `~/.local/share/smart-commit/models/` |

To use a custom location, set `XDG_DATA_HOME` before running:

```bash
XDG_DATA_HOME=/mnt/fast-ssd/.local/share smart-commit
```

---

## Configuration

All configuration is done via environment variables. No config file is required.

| Variable | Default | Description |
|---|---|---|
| `SMART_COMMIT_TIMEOUT_MS` | `120000` | Inference timeout in milliseconds. Set to `0` to disable (not recommended on slow machines). |
| `XDG_DATA_HOME` | *(unset)* | Override the base directory used for model storage. |

### Examples

```bash
# Give the model 5 minutes on a slow machine
SMART_COMMIT_TIMEOUT_MS=300000 smart-commit

# Disable timeout entirely
SMART_COMMIT_TIMEOUT_MS=0 smart-commit

# Store model on a different drive
XDG_DATA_HOME=/mnt/data/.local/share smart-commit
```

---

## Customising the Prompt

All AI behaviour is controlled in a single file: [`src/prompts/commit.ts`](./src/prompts/commit.ts).

### Tuning the system instruction

Edit `SYSTEM_INSTRUCTION` to change the model's persona or output requirements.

### Adding few-shot examples

Add entries to the `EXAMPLES` array to teach the model patterns specific to your codebase. Each entry is a `{ diff, message }` pair:

```ts
const EXAMPLES = [
  // ...existing examples...
  {
    diff: `diff --git a/infra/terraform/main.tf
+resource "aws_s3_bucket" "assets" {}`,
    message: "feat(infra): add S3 assets bucket to Terraform config",
  },
];
```

More examples = more consistent output for your specific project structure.

### Tweaking inference parameters

In [`src/workers/ai-worker.ts`](./src/workers/ai-worker.ts), the inference call accepts standard llama.cpp parameters:

```ts
const rawResponse = await session.prompt(getUserPrompt(diff), {
  maxTokens: 80,      // Max output length — commit messages are short, keep this low
  temperature: 0.2,   // Lower = more deterministic. Range: 0.0–1.0
});
```

After editing prompt files, rebuild with `pnpm run build`.

---

## Project Structure

```
smart-commit/
├── src/
│   ├── index.ts                 # CLI entry point — arg parsing, top-level error handler
│   ├── commands/
│   │   └── commit.ts            # Main command orchestration — git checks, user prompts, commit
│   ├── lib/
│   │   ├── ai.ts                # Forks the AI worker, manages IPC and timeout
│   │   ├── git.ts               # Git utilities — repo check, staged diff, commit execution
│   │   └── git.test.ts          # Unit tests for git utilities (vitest)
│   ├── prompts/
│   │   └── commit.ts            # System prompt, few-shot examples, CC_REGEX validator
│   ├── types/
│   │   └── index.ts             # WorkerMessage discriminated union (IPC contract)
│   └── workers/
│       └── ai-worker.ts         # Child process — model download, LLM inference, output validation
├── models/                      # (gitignored) local dev model location
├── dist/                        # (gitignored) compiled output
├── package.json
└── tsconfig.json
```

---

## Development

```bash
# Clone and install dependencies
git clone https://github.com/your-username/smart-commit.git
cd smart-commit
pnpm install

# Build (compiles TypeScript to dist/)
pnpm run build

# Run directly from dist after building
node dist/index.js
```

> **Tip:** The tool must be run from inside a git repository with staged changes, or it will exit with a clear error message.

---

## Testing

Tests are written with [vitest](https://vitest.dev/) and cover the git utility layer with fully hermetic mocks — no real git processes are spawned.

```bash
# Run tests once
pnpm run test

# Run tests in watch mode
pnpm run test:watch
```

### Test coverage areas

| Test file | What's tested |
|---|---|
| `src/lib/git.test.ts` | `isGitRepository`, `hasStagedChanges`, `getStagedDiff` — all branches including error paths |

---

## Building

```bash
pnpm run build
```

This compiles `src/` to `dist/` using the TypeScript compiler (`tsc`). The `build` step is also run automatically before `pnpm publish` via the `prepublishOnly` hook.

**TypeScript settings of note** (see [`tsconfig.json`](./tsconfig.json)):

- `"module": "nodenext"` + `"moduleResolution": "NodeNext"` — native Node ESM handling
- `"strict": true`, `"noUncheckedIndexedAccess": true` — maximum type safety
- `"verbatimModuleSyntax": true` — ensures `import type` is used correctly

---

## Troubleshooting

### `❌ Error: You are not inside a valid Git repository directory.`
Run `smart-commit` from within a directory that has been initialised with `git init`.

### `❌ No staged changes found. Run 'git add' on your files first.`
You need to stage files before running the tool:
```bash
git add <file>   # or: git add .
```

### `❌ AI Generation failed: AI inference timed out after 120s`
Your machine is slower than the default timeout. Increase it:
```bash
SMART_COMMIT_TIMEOUT_MS=300000 smart-commit
```
Or disable it temporarily: `SMART_COMMIT_TIMEOUT_MS=0 smart-commit`

### `❌ AI Generation failed: Model produced an invalid commit message format`
The model generated output that doesn't match Conventional Commits format. This is rare but can happen on very large or unusual diffs. When this occurs you will be invited to enter a commit message manually.

### The model keeps re-downloading
This usually means the model path is resolving differently between runs (e.g. `XDG_DATA_HOME` is set inconsistently). Check where the model is stored:
```bash
# The worker logs the resolved path on startup
SMART_COMMIT_TIMEOUT_MS=0 smart-commit 2>&1 | head -5
```
Then verify the `.gguf` file exists at that path.

### `[node-llama-cpp] load: control-looking token ... was not control-type`
This is a harmless warning emitted by the underlying C++ library for certain model quantisations. It does not affect output quality and can be safely ignored.

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository and create a feature branch.
2. **Install** dependencies: `pnpm install`
3. **Make changes** — keep them focused and well-commented.
4. **Add/update tests** in `src/lib/*.test.ts`.
5. **Verify** the build and tests pass:
   ```bash
   pnpm run build && pnpm run test
   ```
6. Open a **Pull Request** with a clear description of what changed and why.

### Good places to contribute

- 🧪 Expand test coverage to the `prompts/` module
- 🌐 Add macOS/Windows-specific model storage paths
- 🎛️ Add a `--dry-run` flag that prints the suggested message without prompting
- 🔁 Add a `--regenerate` flag to ask the model for a second opinion

---

## License

ISC — see [LICENSE](./LICENSE) for details.
