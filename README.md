# Oriclus

Explore dependency release histories, resolve candidate upgrades, and test them in branchable Nebius Sandboxes. Oriclus is a local, single-operator workspace. A version that resolves is not necessarily tested; passing selected tests does not guarantee compatibility.

## Get started

Requirements: Python 3.12+, [uv](https://docs.astral.sh/uv/), Node.js 22.12+, npm, and access to Nebius Token Factory Sandboxes. Existing Docker history remains available as read-only records.

```sh
uv sync --frozen
npm ci
npm run build
cp .env.example .env
```

Set the following in `.env`, without committing it:

- `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, and `NEBIUS_MODEL`: Token Factory inference credentials, endpoint and NVIDIA model for explanations and repairs.
- `NEBIUS_PROJECT_ID`: project with Sandboxes access.
- `NEBIUS_SANDBOX_API_KEY`: Sandbox key, if different from `NEBIUS_API_KEY`; otherwise leave blank.
- `TAVILY_API_KEY`: optional for user-requested dependency research in What’s New.

Restart the service after changing credentials. Start the workspace:

```sh
uv run uvicorn server.app:app --host 127.0.0.1 --port 8787
```

Open http://127.0.0.1:8787. The API controls code execution and is designed for loopback, not public hosting.

## Time machine

Choose a public GitHub repository or an absolute local project directory. Oriclus snapshots files without modifying the source, reads supported manifests and fetches release metadata from public registries. The timeline aligns releases on publication dates; rows include direct dependencies and related entries from lockfiles, resolved candidates, and registry declarations for up to 25 exactly pinned direct dependencies. Registry declarations can include optional dependencies and do not prove installation; unpinned releases require resolution for additional related entries. Missing dates and metadata are shown as unknown. Choose a release to resolve a candidate set and inspect declared requirements. A resolution is not a test result.

To run an experiment, add releases from up to five dependencies, optionally choose a required release as the upgrade goal, review the test command, and choose **Run Sandbox tests**. Each dependency can have up to five selected releases and the Cartesian product is limited to 12 combinations. Oriclus prepares the project once, checks the baseline, and runs up to three independent candidate branches concurrently with the same selected tests offline. The comparison lists resolution, test, and repair outcomes per combination; a resolution failure or installation error is inconclusive, not a test failure. When current versions or exact manifest pins are known, the interface suggests qualifying combinations with the fewest changes to selected dependencies; this is not a global optimum. A passing baseline is required to classify a candidate as passed or failed. For a new failure, Nemotron may propose a source patch, which is checked against the original tests on a fresh candidate branch. The patch is not applied to the user's project. The agent cannot currently edit dependency manifests or locks; version suggestions in model text are unverified until included in another run.

Two deliberately small examples are available:

- `examples/timeline-python`: Flask, Werkzeug and MarkupSafe shown together; try MarkupSafe 2.0.1 to 2.1.5 with test command `python -m unittest -v`.
- `examples/timeline-node`: minimatch 3.1.2 to 9.0.5, test command `npm test`.
- `examples/httpx-starlette`: HTTPX 0.27.2 to 0.28.0 against Starlette 0.36.3, test command `python -m unittest -v`.
- `examples/unrepairable`: a negative control where the failing test itself imports a removed API; the repair must not change tests.
- `examples/legacy-matrix`: a deliberately constructed Flask/SQLAlchemy web application with five related dependencies and legacy API usage. It is not a production application.

See [evaluation cases](docs/evaluation-cases.md) for a real JavaScript repository, a resolver conflict and actual results, including failures. The [demonstration script](docs/demo-script.md) separates recorded results from live execution. The [submission checklist](docs/submission-checklist.md) and [maintainer evaluation guide](docs/maintainer-evaluation.md) identify outstanding work without inventing user feedback.

These examples demonstrate a breaking change; they are not claims about every application using those packages. Resolution and tests use registry access and Sandbox compute and can consume credits.

## What's New and metrics

Analyze projects in Time Machine, then open **What’s New** to see a locally persisted feed grouped by distinct dependencies across saved project analyses. Filter by name or project, then choose **Refresh feed** to search all libraries matching the current filters once each; the progress indicator supports cancellation. You may also research a specific release. Only package names and selected versions are sent to Tavily; package names can themselves be sensitive. Search results are public, external sources and may be stale, incomplete or unrelated. The configured model may summarize them; citations link to returned sources, and summaries are advisory. Previously requested research for the same dependency and version can be supplied to the repair agent. No source proves a test passed. Search and inference may consume credits.

The Metrics page measures completed runs divided by terminal runs, median seconds from run creation to first conclusive candidate result, and verified repairs divided by recorded repair attempts. Active runs are excluded from completion; historical runs lacking timing are excluded from timing. The numbers describe local recorded runs, not product-wide accuracy or a comparison to uv. See [who benefits](docs/who-benefits.md).

## Supported inputs and limitations

Python discovery reads `pyproject.toml` or `requirements.txt`; `uv.lock` and `poetry.lock` select their respective managers, otherwise pip is used. JavaScript/TypeScript discovery reads `package.json`; `yarn.lock` and `pnpm-lock.yaml` select those managers, otherwise npm is used, including `package-lock.json`. Native resolver and install commands are used in isolated Sandbox copies. Check the UI warnings for unsupported requirements, dynamic metadata, duplicate package instances and incomplete lockfile details. Complex workspaces, private registries, package-manager-specific configuration, external services and unusual scripts may require additional configuration and are not guaranteed to work.

Go modules and Rust Cargo discovery and resolution are experimental and unverified. Sandbox test execution is currently limited to Python and JavaScript/TypeScript. Release history and selected tests are bounded: Oriclus does not infer outcomes for untested releases or claim the globally first breaking version.

## Data and security

Oriclus creates a local snapshot in `.oriclus/timeline/`, excluding `.env*`, common credential directories/files, private-key extensions, Git metadata, dependency directories, generated output and symlinks. This is a best-effort exclusion, not a secret scanner. Review your source before using a local project: other sensitive files may remain. Source snapshots are uploaded to Nebius Sandboxes when resolving or running tests. Selected test output and source context requested by the agent can be sent to the configured Nebius inference model. Consult your organization's policies before uploading private data.

Dependency installation and resolution require network access and may execute project or package code. Tests, model tool operations and patch verification explicitly request no Sandbox network access. No model or Sandbox API credentials are passed to guest commands. Nebius controls image, upload, operation and log retention; a disposable operation does not guarantee that every service record is deleted. See [Sandbox security and data handling](https://docs.tokenfactory.nebius.com/sandboxes/operate/security-and-data-handling). Use trusted inputs and review commands and patches.

`.oriclus/` contains local analyses, runs, history and artifacts and is excluded from Git. Previous Docker rehearsal history remains readable from History; new experiments use Time Machine. Its original history and verification are preserved in [docs/legacy-rehearsal.md](docs/legacy-rehearsal.md).

## Development

```sh
uv run python -m unittest discover -s tests -v
uv run ruff check server tests scripts
uv run ruff format --check server tests scripts
npm run format:check
npm run build
```

For local frontend work, run `npm run dev` alongside the API. Live Sandbox and inference tests require valid credentials, network access and credits. They are not a substitute for unit tests.

### Repeat a uv comparison

Run from the repository root:

```sh
uv run python -m scripts.benchmark_uv --trials 1
```

The default compares the bundled Python example, MarkupSafe 2.0.1 and 2.1.5, and `python -m unittest -v`. Use `--project`, `--package`, `--versions`, and `--test` for another supported pip project with a `requirements.txt` file; `--trials` accepts 1–5. Both paths use separate Nebius Sandbox branches from the same project and run the same candidate constraints and tests. The uv-only path installs with uv and does not perform an AI repair; Oriclus uses the project's pip resolver, records results and can run repair verification. Resolver choices, caching, network, image preparation and other work can differ, so matching outcomes do not imply identical environments or equal effort. The script prints trial data and denominators to the console without writing a comparison file. Oriclus experiment records are still saved in the local `.oriclus/` history. Sandbox and model calls can consume credits.

Release-specific research appears on the main timeline as an outlined marker and is shown with citations in the selected release panel. General searches without a specific version do not imply relevance to an individual release. New experiments record a provisional model-authored plan and the public model messages, tool requests, and tool outcomes; older runs cannot reconstruct decisions they did not record. These are saved locally with the run and can include code or commands, so protect local history as project data. The plan is advisory and may change as the agent learns from tool results.
