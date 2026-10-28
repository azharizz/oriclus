# Oriclus

Historical record: the Docker rehearsal interface described below has been retired. Its data remains stored locally and accessible through the legacy API; old run links now open Time Machine History.

Trace upstream changes through real downstream tests and model-authored repairs.

Current iteration, 2026-09-20: the desktop interface now follows Nebius Token Factory's visual system. The production frontend is built and served on port 8787. Backend checks and desktop interaction checks pass. **Automatic discovery is not yet reliable:** four live attempts with the configured model failed to produce a supported setup within the turn budget. Manual setup, import and reuse remain available. See the current verification record below for the scope of these checks.

## Research and implementation plan

Research date: 2026-09-19. This document holds the research, decisions, execution plan, operating instructions and verification record.

### Product decision

The supplied brief proposes ecosystem-wide release rehearsal. The implemented scope is public Python GitHub repositories, a small reviewed consumer cohort, baseline/candidate Git refs, actual commands in Docker, up to three independent repair candidates, fresh-container verification and patch export. The new default flow uses the configured model to discover consumers and propose the setup; manual configuration remains available. A React workspace exposes the evidence and persistent run history. No PR is published automatically.

Two approaches were considered:

1. Docker now: checkpoint installed filesystem state with `docker commit`, branch fresh containers, isolate tests from the network, remove per-run resources after completion. This works with current access.
2. Native Nebius Sandboxes: use ConTree versioned image results as branch parents. Implement after access is granted and real integration tests are possible. No inactive adapter is shipped.

Selected: Docker now, one concrete executor module with create/run/snapshot/remove operations. No provider framework, model router, queue service or distributed worker system.

### Findings and sources

- [Nebius tool calling](https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling) uses the OpenAI-compatible Chat Completions tool-call loop. The app sends tool schemas, executes returned calls, and returns actual tool results to the configured model. No keyword decision engine substitutes for inference.
- [Nebius structured output](https://docs.tokenfactory.nebius.com/ai-models-inference/json) supports JSON Schema for analysis, patch selection and assessments. The returned JSON is checked against the same typed contract. Invalid responses remain failures rather than invented decisions.
- [ConTree branching](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/branching) branches from an immutable filesystem state. `child = await parent.run(shell=..., disposable=False)` yields a new image UUID; separate calls on the parent produce independent children.
- [ConTree SDK](https://github.com/nebius/contree-sdk) separates transport/authentication into `contree_client`. Its documented hosted endpoint is `https://api.tokenfactory.nebius.com/sandboxes`. Credentials and access must be checked separately from inference.
- [NVIDIA Nemotron 3.5 Lightning](https://docs.nvidia.com/nim/large-language-models/2.0.10/get-started/advanced/get-started-nemotron-3.5-lightning.html) supports reasoning, coding and tool use. This project uses NVIDIA's model through Nebius, not a locally deployed NIM. Model identity and endpoint come exclusively from the project's `.env`.
- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model) distinguishes model-specific reasoning and tool parameters. Its GPT-6 settings apply to that model, not to the Nebius model. Reading documentation does not change this task's runtime model or reasoning setting. Implementation follows explicit contracts and executable verification.
- [Rust Crater](https://github.com/rust-lang/crater) already compares ecosystem builds and tests across compiler versions, including Docker isolation. Ecosystem regression testing itself is not novel. Oriclus combines upstream evidence, consumer execution, model-authored repair branches and independently rerun patch evidence. No claim of being the first is warranted.
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) accepts a server-side bearer credential. Oriclus requests five basic-search sources, without a generated answer or full raw page content, and preserves source URLs, snippets, request IDs and reported usage. Initial upstream research and model-requested repair searches use the same endpoint.
- [HTTPX changelog](https://github.com/encode/httpx/blob/master/CHANGELOG.md) records removal of deprecated `app` in 0.28. [Starlette maintainers' discussion](https://github.com/Kludex/starlette/discussions/2770) confirms the resulting TestClient breakage. These are suitable historical input refs, not a canned repair or precomputed result.

The brief's prize predictions, competitor counts and future market claims are not product facts. PyPI does not supply a complete reverse-dependency API. Model discovery proposes a bounded cohort using Tavily and actual public GitHub source. Every proposed consumer needs a dependency/import excerpt from a file the model read at its selected commit. Search results support model interpretation; they are not an exhaustive dependency index or a test result.

### Execution stages and checks

1. Implement request contracts, SQLite history, local HTTP security and Docker execution. Verify URL/ref/path validation, storage recovery, snapshot independence and cancellation.
2. Implement real Nebius tool calls, bounded iteration budgets, independent candidate forks and untouched verification. Verify a live tool roundtrip and reject patches outside the configured source paths.
3. Implement the complete rehearsal: clone exact refs, build both upstream wheels, install a shared downstream environment, fork baseline/candidate states, compare actual exit codes, investigate regressions and export patches. Verify on real HTTPX and Starlette tags.
4. Implement the React workspace: create run, consumer configuration, history, lineage, evidence, patch downloads, cancellation, errors and mobile layout. Use declarative state and query polling without effect hooks.
5. Run backend checks, strict TypeScript/build, browser desktop/mobile checks and Impeccable detector. Record actual results below, not expected results.

### Design direction

The user selected [Nebius Token Factory](https://tokenfactory.nebius.com/) as the desktop reference. Its live home and catalog informed the Inter typography, charcoal background, purple primary actions, outlined brand blocks, fixed header and compact sidebar. The Oriclus mark is original geometric artwork in the reference's lime and mint palette. [DESIGN.md](DESIGN.md) records the implemented tokens and component rules. Configuration, source excerpts, model analysis and execution logs use native disclosures. History, activity, research and downstream results remain paginated. Desktop screenshots and the Impeccable detector were reviewed; mobile work is deferred at the user's request.

## Operating contract

This is a local, single-operator application. Bind to loopback. Do not expose the Docker-controlling API to a public network. Only public HTTPS GitHub repository URLs are accepted. Run source you trust: Docker containers share a kernel and are not ConTree microVMs. Setup requires network access to GitHub/PyPI and runs repository build/install code. Test, repair and verification containers have no network, no host mounts, no Docker socket, no model credentials, non-root users, dropped capabilities and resource limits. The service alone can access `.env`. Tavily receives public package/repository/version queries and any public research query requested by the agent. Nebius receives source diffs, test output and retrieved context. Neither API key enters the frontend, containers or Git. Retrieved text is treated as untrusted context. Failed searches are recorded as incomplete grounding; the actual tests can continue without sources.

Tests requiring external services need a separately designed network policy. Network-dependent failures are reported as inability to evaluate, not silently rerouted to the host. The selected test command is the verification boundary; its coverage limits every result. A passing patch is a proposed migration, not an applied downstream release. Model conclusions are advisory and labeled.

There are no application wall-clock timeouts. HTTPX uses `timeout=None`; Docker subprocesses wait until exit or explicit cancellation. Agent turns and generated tokens are cost/iteration budgets, configurable through `.env`, not timers. The turn budget is 32: live traces showed 16 turns could stop a real source investigation before the model finished. Any edits present at the budget boundary still undergo independent verification. Output is bounded with explicit truncation notices to protect memory and context. Run one service process: the in-process task owner and SQLite store target one operator. Shutdown cancels active work; startup marks unfinished runs interrupted and cleans only resources labeled for this workspace.

## ConTree migration map

| Docker operation | ConTree equivalent | Required live proof |
| --- | --- | --- |
| Build sandbox Dockerfile | Import equivalent OCI image with `images.oci(...)` | Git, Python and build tooling available |
| Create from image, execute shell | `image.run(shell=..., disposable=False)` | Exit status and stdout/stderr preserved |
| `docker commit` checkpoint | Persist result image UUID | Installed files survive branching |
| Several containers from image ID | Several `parent.run(...)` calls | No candidate leaks into another |
| Apply patch on fresh candidate image | Apply patch in a new result branch | Original tests and pinned upstream preserved |
| Container cancellation and cleanup | Operation cancellation and image lifecycle APIs | Cancelled operations stop, retention is bounded |

Replace `server/sandbox.py` with a real ConTree implementation after verifying the SDK's current resource/network controls and cancellation behavior. Adapt the workflow's small operation calls if required. Docker snapshots capture files, not process memory, and do not have ConTree's latency or isolation properties. Do not advertise feature parity.

## Setup

Requirements: Python 3.12+, uv, Node 22.12+, Docker Engine or Docker Desktop running.

```sh
uv sync --frozen
npm ci
npm run build
docker build -t oriclus-python:local -f sandbox.Dockerfile .
uv run uvicorn server.app:app --host 127.0.0.1 --port 8787
```

Open http://127.0.0.1:8787. For frontend development use `npm run dev` alongside the API.

On a new checkout, copy `.env.example` to `.env` and fill in the three Nebius values and `TAVILY_API_KEY` before starting a grounded rehearsal. Preserve an existing `.env`. Keep `NEBIUS_MODEL`, `NEBIUS_BASE_URL`, `NEBIUS_API_KEY` and `TAVILY_API_KEY` in this directory's `.env`. Restart the service after changing them. Connections reports whether values are configured; each run records whether the provider actually answered. Never prefix credentials with `VITE_`. `.env`, `.venv`, `node_modules`, generated evidence and the SQLite database are ignored by Git and Docker build context. `.env.example` contains only variable names and public operational defaults.

Run history and artifacts live under `.oriclus/`. The API exposes run JSON and patch artifacts through the workspace; stop the service before backing up this directory so SQLite and its WAL remain consistent. A failed or cancelled run retains the observations collected before it stopped. Use a new run to retry after correcting the source configuration or provider access.

Historical replay: import `examples/httpx-starlette.json` or choose **Try an example**. It uses the same execution path as every other request. It downloads real tags, runs real tests, calls the configured live model, and can fail. No outcomes or patches are included in the example. Historical test dependencies are pinned in its install commands because current dependency releases introduce unrelated baseline failures. The same warnings policy and untouched test command run on both dependency versions and every verifier.

### Everyday workflow

1. Enter a public GitHub repository URL or `owner/library`. Optionally enter the branch, tag or commit in **Change to evaluate**, then choose **Prepare check**. The default comparison is shown beside the collapsed options for an explicit baseline or specific consumers.
2. The configured Nebius model reads repository metadata, exact commits, files and Tavily sources. It proposes one to three consumers, setup/test commands and production source directories. Discovery executes no repository code.
3. Review the proposed projects and choose **Check projects**. The proposal pins upstream and consumer refs to inspected commits. You can exclude projects or edit the setup before starting. This starts the existing Docker baseline, candidate, repair and independent verification workflow under the same history record.
4. Read the recorded results first. Expand only the logs, patch, sources or model assessment needed for a decision. Download passing patches for code review. Failed patches remain available and labeled.

Automatic discovery proposes the latest stable release against the default branch, or the preceding stable release when those resolve to the same commit. Version tags come from GitHub and must be inspected. Repositories without usable version history need explicit refs. Repository contents are untrusted input; the model's commands and dependency interpretation still need review. A cited excerpt proves its source, not that the inferred setup will work. A failed baseline remains an incomplete comparison.

**Manual setup** accepts a full configuration for up to ten consumers. **Import setup** validates JSON with the same server contract, and accepts a small evidence export's `request` field as well (256 KB file limit). **Reuse setup**, manifest import and the example open a compact review with **Start check** immediately available and **Edit setup** collapsed. Switching between automatic and manual setup preserves the repository and refs. Both install and test commands are required; the server does not invent them when omitted.

GitHub discovery currently uses the public, unauthenticated REST API. Its shared quota can stop discovery; a refusal is recorded, with manual setup available. Files are limited to 64 KB, API responses to 2 MB, and inspected trees to 1,500 files with truncation reported to the model. Large repositories or setups requiring external services may not yield a supported proposal. No language-agnostic or exhaustive coverage is claimed. Discovery uses the existing configurable model turn/token budgets and adds no timeout or dependency.

### HTTP workflow and pagination

| Endpoint | Contract |
| --- | --- |
| `POST /api/runs/prepare` | `{upstream, baseline_ref?, candidate_ref?, consumers?}`; creates a `planning` record, then `ready`, `failed` or `cancelled`. Consumers are optional repository URLs/slugs, maximum three. No repository code runs. |
| `POST /api/runs/{id}/start` | Reviewed full `RunRequest`; starts only a `ready` record, retaining proposal evidence and the original `prepared_request`. Edits are recorded as the executed request. |
| `POST /api/runs` | Full manual `RunRequest`, immediate rehearsal. |
| `POST /api/setup/validate` | Validates and normalizes a full imported setup without starting anything. |
| `GET /api/runs?limit=10&offset=0&q=&status=` | `{items, total}` with lightweight summaries; search/status filters apply before pagination. Maximum page size 50. |
| `GET /api/runs/{id}?brief=true` | Progress and result summaries without large test outputs, patch explanations, source searches or upstream diff. Default `brief=false` retains the full run document. |
| `GET /api/runs/{id}/events?limit=15&offset=0&kind=` | `{items, total}` with newest-first event metadata; maximum page size 50. |
| `GET /api/runs/{id}/events/{event_id}` | One event's `{data}` payload, scoped to its owning run. |
| `GET /api/runs/{id}/research?offset=0` | `{items, total}`, five recorded searches per page. |
| `GET /api/runs/{id}/consumers/{index}` | One consumer's complete logs and repair results, loaded when expanded. |
| `GET /api/runs/{id}/export` | Complete run and chronological event payloads, unaffected by pagination. |

The two collection routes (`runs` and `events`) now return page envelopes instead of arrays. Update API clients accordingly. SQLite tables and saved run documents are preserved. Planning and execution share the existing single-job lock; a ready proposal can wait while another check runs. Restart recovery marks interrupted discovery jobs as interrupted, while ready proposals remain reviewable.

## Checks

```sh
uv run python -m unittest discover -s tests -v
uv run ruff check server tests scripts
uv run ruff format --check server tests scripts
npm run format:check
npm run build
uv run python scripts/check_live.py --offline
# Calls the configured paid providers as well:
uv run python scripts/check_live.py
```

The machine-readable API contract is served at `/openapi.json`; no external documentation scripts are loaded by the production service.

The live check requires Docker plus the built sandbox image. Without `--offline`, it calls Nebius and Tavily, executes a real model-selected shell command, returns real search results to the model, and checks that the final response cites a retrieved URL. This incurs provider usage. The offline variant checks isolation, snapshot independence, cancellation and cleanup with no provider calls.

`.github/workflows/checks.yml` runs locked installs, Python 3.12 tests, Ruff, Prettier, the production frontend build and the real Docker offline check on push and pull requests. Action revisions are pinned and checkout credentials are not retained. Local Git is initialized; no remote is configured and hosted Actions has not run.

To run an input manifest through the normal HTTP API, start the service and use:

```sh
curl --fail-with-body http://127.0.0.1:8787/api/runs \
  -H 'Content-Type: application/json' \
  --data-binary @examples/httpx-starlette.json
```

The response contains the run ID. Open `http://127.0.0.1:8787/?run=<id>` or query `/api/runs/<id>`. Only one rehearsal can run at a time. Other reproducible inputs are `examples/markupsafe-consumers.json`, `examples/werkzeug-consumers.json`, and `examples/werkzeug-flask-login.json`. They contain inputs only, with no repair code or expected outcomes.

## Initial verification record

Verified on 2026-09-19 with the configured live Nebius endpoint and `nvidia/Nemotron-3_5-Lightning`, real GitHub source, and Docker. [Open the complete rehearsal](http://127.0.0.1:8787/?run=17c89217874641a4ba6a6b1233b746ca).

| Check | Measured result |
| --- | --- |
| HTTPX 0.27.2 baseline, Starlette 0.36.3 | 39 tests passed |
| HTTPX 0.28.1 candidate, unchanged Starlette 0.36.3 | 39 tests failed with the removed `app` argument |
| Three independently generated repair branches | Each passed all 39 original tests in a fresh verification container |
| Starlette 0.37.2, baseline and candidate | 41 tests passed on each version |
| Live Nebius tool roundtrip | Model requested a shell command, Docker executed it, and the model received its actual output |
| Docker branch independence and isolation | Passed: independent filesystems, non-root, offline execution, no host mounts or credentials |
| Backend regression suite | 8 tests passed, including concurrent submission, trust boundaries, durable recovery and iteration-budget behavior |
| TypeScript, Vite build, Ruff and Prettier | Passed |
| Browser checks | Form population/submission, history, refreshable run links, patches, evidence filtering and environment view passed; no observed console errors |
| Responsive interface | Checked desktop, tablet and 320/389 CSS-pixel mobile widths; mobile form overflow corrected |
| Impeccable | 67-pattern catalog reviewed; source detector returned no findings |
| Cancellation through browser | Run `fdaabbe629744329ae697869805f8c29` became cancelled; evidence retained; no workspace containers or snapshots remained |
| Patch and evidence downloads | HTTP 200 with attachment headers and real artifact content |
| Secret and naming scans | No API key in authored files or production assets; no retired product name or em dashes in authored text |

The verified patches were authored by the configured model, not shipped in the example. Its three branches converged on removing the obsolete argument. They are independent executions, not a claim of three distinct repair strategies. The earlier investigation failures remain in history as real records. The final assessment distinguishes original failures from successful repair verification; natural-language model analysis can still contain inaccuracies and should be checked against the execution ledger.

The delivered operating scope is a local, single-operator Python workspace. Public multi-user hosting, authenticated private repositories, exhaustive dependency discovery, automatic PR publishing, and native ConTree execution are not implemented. Native sandbox access remains the only prerequisite for testing that migration, whose operation mapping is documented above. Docker is the working runtime today.


## Grounding and portability iteration

Previous checkpoint (`97a550e`): real Tavily retrieval and model tool calls, persisted source evidence, source links and research filtering, provider failure handling, both-key redaction, repository manifests, local Git and CI. The 13-test suite passed on Python 3.12 and 3.14 at that checkpoint. The Python 3.12 check exposed an annotation shadowed by `Store.list`; postponed annotation evaluation fixes the import without changing the storage API. Live Nebius shell and Tavily search roundtrips passed. Docker isolation, independent snapshots, cancelled execution and complete resource cleanup passed. TypeScript, production build, Ruff and Prettier passed. Browser checks confirmed source expansion, working source links, keyboard focus, research filtering and actual Tavily configuration status. Long model citations caused horizontal overflow at a 343 CSS-pixel content width; wrapping was corrected and the page width matched its scroll width on recheck. No browser console errors were observed. The Impeccable source detector returned no findings; review used the existing visual system and 67-pattern catalog. Both configured keys were absent from authored files, built assets and Git history.

### Measured repository coverage

These are selected suites in actual public repositories, not full-repository or ecosystem guarantees. Five distinct downstream repositories span three upstream distributions. Every repair was generated by the configured model and applied to a fresh candidate container with the original test command.

| Consumer | Upstream baseline to candidate | Baseline | Unmodified candidate | Repair verification |
| --- | --- | --- | --- | --- |
| Starlette 0.36.3 | HTTPX 0.27.2 to 0.28.1 | 39 passed | 39 failed | Three independent patches, 39 passed each |
| Starlette 0.37.2 | HTTPX 0.27.2 to 0.28.1 | 41 passed | 41 passed | Not needed |
| Flask 2.2.5 | Werkzeug 2.3.8 to 3.0.1 | 158 passed | 158 passed | Not needed |
| Flask-Login 0.6.2 | Werkzeug 2.2.3 to 3.0.1 | 113 passed | Import failure, exit 2 | Model patch failed import collection, exit 2; remains regressed |
| Jinja 2.11.3 | MarkupSafe 2.0.1 to 2.1.5 | 144 passed | Import failure, exit 4 | One patch, 144 passed |
| Mako 1.1.6 | MarkupSafe 2.0.1 to 2.1.5 | 26 passed, 3 skipped | 26 passed, 3 skipped | Not needed |

Evidence: [Starlette](http://127.0.0.1:8787/?run=c992f9e8c108477e8aa7585659743fa5), [Flask with Werkzeug 2.3.8](http://127.0.0.1:8787/?run=024c464bf2644992817799c33e056a21), [Flask-Login with Werkzeug 2.2.3](http://127.0.0.1:8787/?run=c90fe645d9e74af1a1e5df80b54389fe), [initial Jinja/Mako run](http://127.0.0.1:8787/?run=adbbc12f08dc44b6a9c6977df8c41d0d). Each run exports source SHAs, wheel hashes, installed environment, source queries, exact test output and model responses. Failed repairs remain downloadable and are visibly labeled failed.

Two setup corrections came from actual runs: Flask-Login required `semantic_version` and Flask's async dependency; its historical cookie-jar tests already failed against Werkzeug 2.3.8. Werkzeug 2.2.3 gives its 113-test passing baseline. Flask's selected suite instead has a warning-count failure on 2.2.3 with Python 3.12, so the manifests separate these baseline contracts. Earlier failed baseline runs remain in history. No tests were edited or excluded to manufacture a pass.

### Model quality and limits

Execution outcomes and model prose have different reliability. Starlette and Jinja assessments correctly described the original failures and passing patch checks. The first MarkupSafe analysis incorrectly attributed newer release changes to 2.1.5 after reading a current changelog search result. The prompt now requires a changed-file citation and before/after evidence in the exact Git diff for every claimed contract change, and explicitly excludes unsupported claims from newer releases. Historical output is retained for audit. The [replay with the revised prompt](http://127.0.0.1:8787/?run=cd26a71a33aa4a0d818261aa8854153d) omitted the newer-release claims and cited changed source files. Its separate repair again passed 144 tests, but used `str` instead of the earlier patch's `soft_str`; a passing selected suite does not establish behavioral equivalence. Its assessment also falsely described the patch as incorporated. Oriclus does not publish or apply patches to downstream repositories.

The Flask-Login patch imported a nonexistent standard-library name and failed verification. Its final assessment also incorrectly said no independent verification occurred while citing that failed verification. The displayed test records are the authority. Structured output validates response shape, not factual accuracy. Search grounding and stronger instructions do not guarantee that the configured model produces reliable explanations or successful repairs. Review proposed source changes and the ledger before adopting any patch.

### Using another repository

Two approaches are implemented: automatic discovery proposes setup from a public GitHub repository, or manual setup accepts repository-specific inputs and JSON manifests. No repository names or fixes are hardcoded into discovery or the execution engine. The reviewed execution contract contains an upstream public GitHub URL, buildable Python distribution, two Git refs, downstream repositories/refs, setup commands, original test commands and permitted production source directories. Automatic discovery is new code and has not been exercised live yet.

Support is bounded by the installed Python 3.12 sandbox and offline execution phase. Private repositories, non-Python builds, external-service integration tests, exhaustive consumer discovery and automatic PR publishing are outside this implementation. An arbitrary repository may need different dependencies or a custom sandbox image through `SANDBOX_IMAGE`. A failing baseline is an invalid comparison and remains visible as such. Native Nebius Sandboxes remains pending access; the migration map above is the next platform step.

Sources: [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search), [uv on GitHub Actions](https://docs.astral.sh/uv/guides/integration/github/), [GitHub Python checks](https://docs.github.com/en/actions/tutorials/build-and-test-code/python), and [versioned MarkupSafe changes](https://github.com/pallets/markupsafe/blob/2.1.5/CHANGES.rst).

## Repository-first workflow plan, 2026-09-20

User-approved direction: discover downstream repositories and propose configuration automatically. Implement solo in this workspace. The initial instruction was code-only; the subsequent request explicitly authorized working checks and screenshot review. The verification record below supersedes that earlier restriction.

- [x] Add a real model planning loop with read-only GitHub repository/file tools and Tavily discovery. Inspect exact refs and cite retrieved source before proposing consumer commands. Persist planning, cancellation, failures and the reviewable proposal in existing run history. Never execute repository commands during discovery.
- [x] Add a repository-first entry form, optional version and repository constraints, a compact proposal review, and one start action. Preserve full manual configuration, manifest import, edits and reusable run configuration under optional controls. A reviewed proposal uses the existing real Docker rehearsal.
- [x] Reduce setup and repeated descriptions, with one primary action. Show downstream outcomes first; expose repairs, source research, analysis and logs on demand. Keep failed verification and model limitations visible where decisions are made. The later user-selected Nebius template adds a compact sidebar.
- [x] Paginate history and execution events in SQLite, filter before pagination, retain complete evidence exports, and load individual event payloads only on demand. Paginate source research and downstream lists in the UI.
- [x] Write regression checks for pagination and proposal provenance, then execute them after testing was authorized. Document the new API and actual verification status. Preserve existing data, real discovery and model-selected commands.

Implementation boundaries: `server/planning.py` owns discovery and proposal provenance; `server/app.py`, `store.py`, `config.py` own lifecycle and paginated HTTP contracts. `Composer.tsx` owns minimal setup and optional editing; `RunView.tsx` owns outcome review; `App.tsx` owns navigation/history; `api.ts` and `style.css` support them. Reuse the existing Nebius completion, Tavily search, SQLite ledger and Docker workflow. No second agent orchestration layer.

The initial green visual direction was superseded by the user's Nebius Token Factory reference. Automatic proposal remains the main approach; manual configuration is the optional alternative. GitHub search is not a complete reverse-dependency index. Suggested consumers and commands remain model proposals until their actual baseline and candidate tests run.

References: [GitHub repository metadata](https://docs.github.com/en/rest/repos/repos#get-a-repository), [Git trees](https://docs.github.com/en/rest/git/trees#get-a-tree), [commit resolution](https://docs.github.com/en/rest/commits/commits#get-a-commit), [repository contents](https://docs.github.com/en/rest/repos/contents#get-repository-content).

Implementation status: the five items above are coded. The 18 backend tests pass, including actual-source citations and commit pinning, read-only GitHub protocol handling, required commands, start-once review, pagination, event ownership and complete evidence retention. This does not prove that live inference reliably completes discovery.

- [ ] Obtain a successful live automatic proposal and complete its reviewed Docker rehearsal. Verify that flow's cancellation and recovery against real providers. These remain required before claiming the automatic workflow is production verified. Mobile verification is outside the current desktop scope.

### Follow-up source review

Read the setup, discovery, results, API and SQLite code against the five UX requirements. Corrected three gaps: the target change was buried in optional settings, separate automatic/manual state lost entered repository and refs when switching, and saved/imported setups reopened the entire configuration form. The primary form now shows repository plus an optional change ref, both modes share those values, and populated setups open in a compact review. Result rows show passed/failed outcomes; exit codes remain in expanded output. History is paginated at 10 rows and activity at 15, with server filters applied before pagination. Discovery still calls the configured model, GitHub and Tavily to propose setup from inspected source.

### Current verification record, 2026-09-20

| Check | Observed result |
| --- | --- |
| Backend unit checks | 18 tests passed; Ruff lint and format checks passed. |
| Frontend | Strict TypeScript and production build passed; Prettier passed. Inter is locally bundled, with no runtime font service. |
| Desktop UI | Live screenshots reviewed at the browser's 1800 × 982 viewport: new check, example review, expanded configuration, history, real saved results, Connections and real discovery failure. Sidebar collapse and disclosure controls work. |
| Collections | History's 10-item paging, search and status filtering, activity's 15-item paging and five-search research pages were exercised against saved records. |
| Existing evidence | The saved HTTPX/Starlette run still shows baseline/candidate results and its independently verified patch. This was a UI check of historical execution, not a new Docker rehearsal. |
| Live automatic discovery | Four real attempts failed to complete within the 32-turn budget, including final run `073dc690318a454ea2228c2eaba5ce1e`. No successful proposal or automatic end-to-end rehearsal is claimed. |
| Discovery fixes | GitHub rename redirects, file reads before explicit repository inspection, clearer available-file feedback, a single JSON proposal argument and a focused planning prompt. These address observed failures but have not established reliable live completion. |
| Design detector | Two warnings: Inter and the 200 ms sidebar margin transition. Both match the explicitly selected reference; reduced-motion preferences disable transitions. No claim that detector results alone prove visual quality. |

The review and documentation were performed in this task, without subagents, as requested. Screenshot evidence is saved locally under `.oriclus/screenshots/nebius-*-desktop.png`. The service is refreshed on port 8787. No fresh Docker isolation audit, hosted deployment or mobile audit was performed during the theme change.
