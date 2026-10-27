# Reproducible evaluation cases

## Synthetic five-dependency matrix

Analyze `examples/legacy-matrix`; add Flask 2.2.5 and 2.3.3, SQLAlchemy 1.4.54 and 2.0.29, Werkzeug 2.3.8, Jinja2 3.1.2, and MarkupSafe 2.1.5. Run `python -m unittest -v`. These selections form four combinations. In a real Nebius Sandbox run, baseline passed, all four combinations resolved with pip, and the unchanged Flask 2.2.5 / SQLAlchemy 1.4.54 combination passed. The three combinations containing Flask 2.3.3, SQLAlchemy 2.0.29, or both failed the original test. Nemotron proposed a source patch for each failing combination; each patch passed the original test in a fresh candidate branch. The original failures remain failures in the results.

This is a deliberately constructed single-test reproducer, not a real production project or a statistical measure of repair reliability. A passing test does not establish thread safety, behavior under concurrent requests, production correctness, or support for other versions. Review every proposed patch before use. The Flask-only patch uses a process-global initialization flag and needs particular concurrency review. Results are local to the creator's `.oriclus/` history and must be rerun with Sandbox credentials by other users.

The same application was also tested as a uv-managed temporary project with the five baseline requirements in `pyproject.toml` and a `uv.lock` file. With Flask 2.2.5 and 2.3.3, and SQLAlchemy 1.4.54, Werkzeug 2.3.8, Jinja2 3.1.2, and MarkupSafe 2.1.5 fixed, both candidates resolved: the first passed, the second failed, and a Nemotron source patch passed independent verification. This was another small synthetic case, not proof that all uv project configurations work.

These observations are scoped to the specified project snapshot, commands, dependency versions and Nebius Sandbox environment. Passing tests do not guarantee compatibility. Source and test output are sent to Nebius as described in the README. Run IDs refer to local evidence; they are not included in the repository.

## HTTPX and Starlette

A [reported compatibility issue](https://github.com/Kludex/starlette/discussions/2770) describes Starlette 0.36.3's `TestClient` failing after HTTPX 0.28.0 removed the `app` argument. `examples/httpx-starlette` is an original, minimal reproduction, not the reporter's repository.

- Command: `python -m unittest -v`.
- Observed in Sandbox: baseline passed; HTTPX 0.27.2 passed; HTTPX 0.28.0 failed with `Client.__init__() got an unexpected keyword argument 'app'`.
- Repair result: **rejected**, because no permitted production-source patch was produced. An upgrade or pin may be a reasonable option but the agent is not allowed to alter dependency manifests.
- Local run: `118c6517968f44308f7731ba67f34328`.
- Sources: [HTTPX 0.28.0 release](https://github.com/encode/httpx/releases/tag/0.28.0), [Starlette release notes](https://www.starlette.io/release-notes/#0372-march-5-2024).

## Real JavaScript consumer: two tests, different conclusions

Repository: [microsoft/license-checker-webpack-plugin](https://github.com/microsoft/license-checker-webpack-plugin) at commit `cdefc710375f3da72623fc110b1ed49b16dd7283`. We compared the saved snapshot with that commit's freshly cloned snapshot. The source imports the minimatch default function; the [minimatch 9 changelog](https://github.com/isaacs/minimatch/blob/main/changelog.md) describes named exports.

In a subsequent live four-combination npm Sandbox matrix, minimatch 3.1.2 and 9.0.5 were combined with lodash 4.17.20 and 4.17.21; glob 7.1.6 and semver 6.3.0 were fixed. The same command ran the repository's original 24 tests followed by the focused probe below. All four combinations resolved; both minimatch 3 combinations passed, and both minimatch 9 combinations failed the probe. Nemotron proposed named-export import changes for both failing combinations; each passed the original suite and probe in an independent Sandbox branch. The probe is additional coverage, not an original repository test. These patches target minimatch 9 and have not been shown to preserve support for minimatch 3. Review them before use. Local run: `b0390d41e76e488582df080743b4cad9`.

To reproduce the exact project source, clone the repository and check out that commit, then analyze its local directory in Oriclus. Tests ran in Node 22 Nebius Sandboxes:

1. The repository's existing command `npm test -- --runInBand` passed its 24 tests with both minimatch 3.1.2 and 9.0.5. This test suite **did not detect** the incompatibility. Local run: `a78c1b1dabcb4548a3066022b58da67d`.
2. A separate focused probe of the actual repository's exported `ignoreLicenses` function passed on 3.1.2 and failed on 9.0.5 with `TypeError: satisfiesGlob is not a function`. The proposed repair failed independent verification. This probe is **not part of the repository's original tests**. Local run: `f7d9c149a8054736acd60f7f66506082`.

Focused command:

```sh
node -e 'const {ignoreLicenses}=require("./src/licenseUtils"); const out=ignoreLicenses({alpha:{version:"1.0.0"}},["alpha"]); if (Object.keys(out).length) process.exit(1)'
```

## Resolver conflict

Analyze `examples/timeline-python`, then select Werkzeug 2.2.3. The project's MarkupSafe 2.0.1 pin conflicts with Werkzeug's requirement. A real native resolver reported a conflict, and Nemotron returned an advisory explanation. This is a resolution result, not a test outcome; other package combinations were not inferred.

## Negative control: repair rejected

Analyze `examples/unrepairable`, select MarkupSafe 2.0.1 and 2.1.5, and run `python -m unittest -v`. The test directly imports the removed API, while the agent is not allowed to change tests or dependency requirements. Observed baseline and 2.0.1 passed, 2.1.5 failed, and the repair was rejected. Local run: `ed0abd39f1704c0ab2dae6a1c17383d1`.

## Interpretation and feedback

These are bounded examples, not an estimate of overall repair accuracy or time saved. The real repository's passing original test suite and failing focused probe illustrate that results only cover the selected test. No independent maintainer has yet evaluated this workflow; do not present feedback or productivity claims as measured. A prospective maintainer can be asked which update they are investigating, what they would normally do, and whether the saved evidence changed their decision.
