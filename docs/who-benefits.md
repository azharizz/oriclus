# Who benefits from Oriclus?

Oriclus helps a developer investigate a dependency change using the project's own package manager, public release information and selected tests in Nebius Sandboxes. A passing test is evidence for that particular command and environment, not a guarantee of general compatibility.

| User | Question | How Oriclus can help |
| --- | --- | --- |
| Open-source contributor | Which version caused my change to fail, and what should I put in an issue or pull request? | Compare selected releases, inspect test evidence and read linked upstream sources. |
| Library maintainer | Do selected dependency versions work with my tests? | Run a baseline and candidate versions in separate Sandbox branches and inspect the outcomes. This is a sampled check, not full support-range certification. |
| Individual developer | What does an upgrade add, and will my project still work? | Research a specific release, review source links and run selected tests before editing the local project. |
| Application team | Can we investigate an update with repeatable evidence? | Retain the commands, results and proposed repair for a local project or public repository. Review data handling before uploading company code. |
| Platform team | Which internal services depend on a shared package? | Future opportunity: organization-wide multi-repository discovery and access controls are not currently implemented. |

The package manager remains responsible for resolution. Nemotron's research and repair suggestions are advisory, and only an independently rerun test can verify a proposed patch for that test. Tavily returns public search sources, not proof of compatibility.
