# HTTPX and Starlette compatibility example

This is a small original reproducer of a [reported Starlette TestClient compatibility issue](https://github.com/Kludex/starlette/discussions/2770); it is not the original reporter's project. HTTPX [0.28.0 removed the deprecated `app` argument](https://github.com/encode/httpx/releases/tag/0.28.0). Starlette [0.37.2 removed its use of that argument](https://www.starlette.io/release-notes/#0372-march-5-2024).

In Oriclus, select this directory, choose HTTPX 0.27.2 and 0.28.0, and run `python -m unittest -v`. The intended outcome is a passing baseline and a failing 0.28.0 test; only the recorded run proves the outcome for its specific environment. A useful fix may involve changing the Starlette requirement, which the repair agent currently is not allowed to edit. Do not claim a repair unless independent verification succeeds.
