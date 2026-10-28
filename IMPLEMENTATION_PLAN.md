# Dependency Time Machine implementation checklist

## Show, guide and use experiment evidence

- [x] Select a recorded combination and focus its exact dependency versions on the timeline; mark experiment participation without assigning global pass or fail to an individual version.
- [x] Rank only completed, passing options that meet the selected goal by changes from known current versions; explain unknowns, ties and repairs.
- [x] Make original test evidence, verification and downloadable patches accessible for review without changing the user's project.
- [x] Verify recorded experiments, decision edge cases and the rendered interface, then commit and push.

## Bun, Go, Cargo and large-project follow-up

- [x] Add Bun native resolution and Sandbox testing, with an independently verified example.
- [x] Add Go modules and Cargo native multi-version resolution and offline Sandbox tests, and preserve trustworthy result labels.
- [x] Improve large Python and JavaScript repository support with explicit standalone project-directory selection and clear scope limitations.
- [x] Check regression tests, browser behavior and real Sandbox runs; record actual results and remaining limits, then commit and push checkpoints.

## Large public repositories

- [x] Explore public GitHub root manifests at a recorded commit without a full local snapshot; fetch that same commit in a Sandbox when a supported resolution or test begins.
- [x] Identify Bun projects rather than using npm silently. Initial exploration-only support was followed by native Bun execution above; Clojure remains unsupported and workspace limitations still apply.
- [x] Verify public GitHub preparation, resolution and a focused test in live Sandboxes, and document observed limits. Metabase was explored only; arbitrary-size repositories and full test suites are not established.

## Multi-dependency matrix follow-up

- [x] Select releases across up to five dependencies and build at most 12 combinations.
- [x] Run up to three independent Sandbox branches concurrently; preserve test, resolution, agent and repair evidence for each combination.
- [x] Compare combinations and show a bounded fewest-changes suggestion when current versions are known.
- [x] Add an explicitly synthetic legacy Flask/SQLAlchemy upgrade example.
- [x] Verify the synthetic matrix and source repairs against real Sandbox operations and record the exact results, using pip and uv.
- [x] Verify a bounded npm matrix on an independent real open-source project, including the original tests and a clearly labeled additional probe.
- [ ] Implement a repeatable multi-dependency uv/CI comparison; one exploratory comparison is not a controlled benchmark.
- [x] Verify bounded model-proposed dependency changes in live Sandboxes; record both a verified proposal and a failed full-workflow evaluation. Broader repair reliability remains unproven.

## Workspace follow-up

- [x] Show resolver-selected declared connections on the shared release timeline, with an accessible list and no claim of tested compatibility.
- [x] Put Time Machine experiments in History; preserve Docker records in the legacy API without showing the retired interface.
- [x] Visualize measured experiment, candidate, repair and timing distributions in Metrics.
- [x] Verify the new screens in the browser and run live dependency-repair checks across available package managers. For uv, Poetry, npm, Yarn and pnpm the proposed changes were controlled inputs, not live model results; pip also received live Nemotron proposals.

The approved plan in the task conversation is the source of truth. This checklist tracks its acceptance criteria and must not be used to claim unchecked work.

- [x] Import the original application without secrets, preserve both licenses and push a checkpoint. Preserve local Docker history and artifacts outside Git.
- [x] Analyze public GitHub and local projects; protect credentials and inform users about remote data handling.
- [x] Support pip, uv, Poetry, npm, yarn and pnpm project analysis, native resolution and test execution. Implement Go and Rust as explicitly experimental and unverified.
- [x] Display a scrollable shared-date timeline, direct and expandable transitive dependencies, declared requirements, current releases and candidate resolver choices, including missing-date releases and distinct untested/conflict/test statuses.
- [x] Use real Nebius Sandbox persistent images and independent branches. Run baseline and bounded candidate versions only on request; record progress, commands, image and operation IDs, outputs, cancellation and test results.
- [x] Use Nemotron to explain real failures and propose a patch, then verify any allowed patch from a fresh candidate state. Keep failure and uncertainty visible.
- [x] Preserve legacy Docker APIs and history. Provide setup, data handling, supported managers, experimental scope and Python/JavaScript examples in README.
- [x] Test native resolution, security boundaries, cancellation, original-source immutability, UI keyboard and responsive states, live Python and JavaScript Sandbox cases with independent verification, and existing tests/builds.
- [x] Commit and push meaningful checkpoints; keep public submission readiness and unverified claims honest.

## Verification

- The Sandbox smoke test confirmed filesystem persistence, independent branches and explicitly disabled test networking.
- Live Python example: MarkupSafe 2.0.1 passed, 2.1.5 failed, and a Nemotron-proposed patch passed the original tests in a fresh branch.
- Live JavaScript example: minimatch 3.1.2 passed, 9.0.5 failed, and a Nemotron-proposed source patch passed the original tests in a fresh branch.
- Live native resolution and small baseline/candidate test runs completed for pip, uv, Poetry, npm, yarn and pnpm. Python and npm conflict fixtures returned resolver conflicts; one conflict also received a live Nemotron explanation.
- A live remote operation reached CANCELLED after cancellation. Legacy Docker history was opened from the copied local database and remains labeled Docker.
- Real public GitHub and local projects were inspected in the workspace. The 19-dependency HTTPX timeline was visually inspected; responsive interaction was checked with mock data, not every device or package-manager configuration.
- A live transitive Jinja2 3.1.3 experiment passed its selected Flask import check. Requirement provenance and transitive release rows were confirmed for a live resolved Flask/Werkzeug set.

## Focused workspace follow-up

- [x] Remove creation of legacy rehearsals from navigation; retain historical Docker results as read-only records and preserve the old APIs for history compatibility.
- [x] Show the configured model, live operation stages and recorded activity for experiments; distinguish conflict explanation and repair unavailability from actual test evidence.
- [x] Keep baseline and selected-version testing in independent Nebius Sandbox branches using the project's package manager.
- [x] Add user-requested Tavily release research with source links, optional model summaries, dated source ordering, and previously requested evidence available to repair; source findings are advisory.
- [x] Add local experiment metrics with explicit denominators and timing limitations, plus audience documentation.
- [x] Run a bounded uv-only comparison on the same example and versions; do not save an unfavorable comparison to a benchmark file.

Scope notes: What’s New is manually refreshed and uses search-result publication dates when supplied; dates may be unknown and results can be incomplete. It is not an automatic monitor. Historical experiment records without timing cannot provide time-to-result metrics. Organization-wide private-repository analysis remains future work.

## Agent decisions, release research and repeatable comparison

- [x] Record the model's provisional plan, user-facing messages, requested tool actions and tool outcomes; surface plan failures without inventing a plan. Older records remain unchanged.
- [x] Mark release-specific saved research on the main dependency timeline and show cited, advisory findings beside the selected release.
- [x] Provide a repeatable uv-only versus Oriclus Sandbox comparison for supported pip requirements projects. Print trial results and denominators only; do not write a comparison file. Oriclus run records remain in local history.

## Evidence and usability follow-up

- [x] Add a persistent cross-project dependency news feed, deduplicate shared libraries, and refresh Tavily only through an explicit action with visible scope and progress.
- [x] Improve the timeline with adaptive sub-year dates and accessible release hover/focus details.
- [x] Add reproducible HTTPX/Starlette and real JavaScript-consumer cases, plus clear conflict and inconclusive cases; record actual test results and limits.
- [ ] Prepare judge-facing video/demo materials. The repository is public following the owner's approval.
- [x] Verify backend, frontend, selected real integrations and responsive views, then commit and push checkpoints; broader configurations remain unverified.
