# Oriclus

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React and TypeScript provide the frontend. FastAPI provides the local service; Time Machine analyses, experiments and research are saved under `.oriclus/`, while SQLite retains legacy rehearsal history. Nebius Token Factory Sandboxes provide isolated, branchable execution; configured NVIDIA Nemotron inference supports investigation and repair; Tavily supplies optional public search. The API is intended for loopback, not public hosting.

## Users

Open-source contributors and maintainers, individual developers, and application teams investigating dependency updates. Platform teams can use the workspace for an individual project; organization-wide private repository discovery, cross-service impact mapping and enterprise access controls are future work.

## Product Purpose

Oriclus combines *origo* and *cyclus*: trace dependency changes from an origin through cycles. Help a developer answer: **Which versions of the project's dependencies work together with its existing code and selected tests?**

Oriclus collaborates with the project's package manager. The manager resolves declared requirements; Oriclus adds a shared release timeline, controlled Sandbox experiments, evidence, research and optional model-assisted repair. A resolved set is not a test pass, and a passing test is evidence only for that command and environment.

## Operating Context

A local, single-operator engineering workspace for developers investigating dependency changes. Public GitHub and local sources are supported, with Nebius Sandboxes, configured NVIDIA inference, and optional Tavily research. The service is restricted to loopback rather than publicly hosted.

## Capabilities and Constraints

The main workflow follows show, guide and use:

1. **Explore:** choose a public GitHub repository or local project, optionally a standalone subdirectory. Show direct and related dependencies, declared requirements and available releases on a shared date axis. Users can search, page, zoom, scroll, and use keyboard and hover/focus details. Unknown dates stay available separately.
2. **Resolve:** select a release and use the project's native resolver in a Nebius Sandbox. Show selected versions, requirement provenance and declared links; label conflicts, missing metadata and untested selections honestly. A line is not a claim of compatibility.
3. **Experiment:** select versions across up to five dependencies and at most 12 combinations, optionally set a required-version goal, and run the baseline and the same selected tests in up to three independent Sandbox branches concurrently. Record actual stages, results, commands, operation/image IDs and errors; support cancellation. Installation and resolution may require network; test and verification operations request networking disabled.
4. **Compare and guide:** show recorded combinations alongside available, untested releases. Selecting a result highlights its exact versions and focuses the timeline. For completed runs, suggest all tied passing combinations that meet the chosen goal with the fewest selected-version changes when current versions or exact pins are known. Explain unknowns and do not infer untested outcomes or a global optimum.
5. **Investigate and use:** on a qualifying failure, show actual Nemotron activity, provisional plans, tool requests and outcomes when recorded. A proposed source or supported dependency-file repair is tested independently. Clearly identify failures, unavailable or rejected repairs, and options that pass only after a patch. Let the user review and download patches; never apply them automatically.
6. **Research and revisit:** What's New offers a manually refreshed, locally persisted feed grouped by dependency across analyzed projects. Tavily provides public sources, optional model summaries and release-specific research linked to the timeline and available as agent evidence. History reopens recorded experiments. Metrics visualize local completion, test outcomes, timing and repair verification with denominators.

## Supported projects and boundaries

- Python: pip, uv and Poetry; JavaScript/TypeScript: npm, Yarn, pnpm and Bun. Use native package-manager resolution and installation, within the supported project forms.
- Go modules and Rust Cargo: experimental single-module integrations. Live Sandbox examples passed, but workspaces, custom registries and broad real-world configurations are not proven. Cargo path, Git, workspace, alias and custom-registry dependencies are skipped with warnings; Cargo selection is limited to direct dependencies. Go uses a 1.24 Sandbox image and dates are fetched for at most 30 recent releases per module. Bun uses an `oven/bun:1` image and does not enforce the manifest's exact Bun version.
- Dependency-file repair supports bounded pip, uv, Poetry, npm, Yarn and pnpm forms. It does not support Bun, Go or Cargo. Rust source repair is disabled because tests may be embedded in source files. Model-generated patches may fail or be rejected.
- GitHub exploration reads supported manifests at a recorded commit; resolution and testing fetch that commit in a Sandbox. A selected subdirectory excludes parent workspace and sibling files from the saved project, so dependent monorepo packages may not work. Local snapshots are limited to 100 MB or 10,000 files and compressed uploads to 50 MB. GitHub source preparation fetches the full repository in the Sandbox before retaining the chosen scope.
- Snapshot exclusions are best effort, not a secret scanner. Source and selected test output may be sent to Nebius; dependency names and selected versions may be sent to Tavily. Credentials must not be committed or passed to guest code. Explain network, retention, cost, and data-handling boundaries before execution.
- The timeline does not automatically identify the first observed breaking release across a tested range. What's New is manually refreshed, not an autonomous monitoring system. Search findings and model explanations are advisory, never a substitute for native resolution and recorded tests.
- Release Rehearsal is retired from the product UI. Historical Docker records remain accessible through the legacy API and are not Time Machine Sandbox results.

## Current Verification Status

The latest recorded checks passed 69 backend tests, seven frontend decision tests, Ruff, frontend formatting and the production build. Browser checks used saved Bun and real JavaScript experiment records to verify selected-version highlighting, original failures, repair evidence and patch review. They did not create new Sandbox runs for the decision UI.

Real Nebius Sandbox evaluations have exercised baseline and candidate runs, independent branches, disabled test networking, cancellation, native resolution for pip, uv, Poetry, npm, Yarn and pnpm, and verified as well as failed or rejected model-proposed patches. A synthetic five-dependency Flask/SQLAlchemy matrix and a real JavaScript repository matrix demonstrated resolution successes followed by test failures and independently verified repairs. The JavaScript failure required an extra focused probe beyond the repository's original tests. Small Bun, Go and Cargo examples each passed four two-dependency combinations; no failing candidates or AI repairs for those three managers have been demonstrated.

Metabase manifests and a prepared Sandbox snapshot were inspected without running Metabase application tests. Flask and FastAPI public repository experiments used focused probes rather than complete original suites. Independent maintainer feedback, broad production deployment, full monorepo support, and a repeatable multi-dependency uv/CI comparison are not established. See [evaluation cases](docs/evaluation-cases.md) and [implementation checklist](IMPLEMENTATION_PLAN.md) for scope and recorded failures.

## Brand Commitments

Name: Oriclus. Use plain engineering language and no em dashes. Do not fabricate results, integrations, performance benefits, user feedback, or judging scores. Keep the existing Nebius-inspired desktop console: Inter, charcoal surfaces, purple controls, compact navigation and an outlined wordmark with the original lime and mint cycle mark. See [DESIGN.md](DESIGN.md).
