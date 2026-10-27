# Dependency Time Machine implementation checklist

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
