# Judge demonstration script

Target length: under three minutes. Show the application itself; do not imply that a replay is a fresh run. Review each source and test result before recording.

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00–0:20 | Project timeline with HTTPX and Starlette rows | “Maintainers need to know which dependency changes work together. Oriclus compares selected versions against the actual project tests.” |
| 0:20–0:45 | Choose HTTPX 0.27.2 and 0.28.0, show shared axis, quarter labels and release hover | “The timeline shows releases together. The resolver uses the project's package manager; a resolved version is not yet a passing test.” |
| 0:45–1:20 | Saved Sandbox run and results | “The baseline and 0.27.2 passed. The 0.28.0 test failed in this specific reproducer. Oriclus ran separate branches and kept the commands and outputs.” |
| 1:20–1:45 | Agent plan and repair result | “Nemotron investigates using Sandbox tools. Here the repair was rejected, so Oriclus keeps the failure visible rather than claiming a fix.” |
| 1:45–2:10 | What’s New feed, filter to HTTPX, sources and timeline link | “Tavily finds sources for the libraries in saved projects. Sources and model summaries are advisory; the selected tests are the compatibility evidence.” |
| 2:10–2:35 | Microsoft JavaScript case and targeted probe | “On a real JavaScript repository, the original 24 tests passed both versions. A separate focused probe failed on minimatch 9; its attempted repair did not verify. This shows why test scope matters.” |
| 2:35–2:50 | README and limitations | “Oriclus works with the project's package manager. Results are limited to tested versions, commands and environments.” |

Preparation: analyze the HTTPX example, run the two selected versions and refresh research for HTTPX; load the saved JavaScript evidence if it remains available. The judge's instance will not contain another user's local history. Re-run the examples using valid credentials or clearly present a separately prepared replay as recorded evidence. Check that `.env`, private paths and credentials are not visible in the video.
