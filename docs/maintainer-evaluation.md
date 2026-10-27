# Maintainer evaluation guide

This is a proposed protocol, not evidence that a user study occurred. Invite a maintainer who consents to a test and already has an actual dependency upgrade they want to investigate. Do not upload private code or send package names to Tavily without their informed approval.

1. Agree on the project snapshot, dependency versions and test command. Record the baseline status and any known expected result.
2. Time and document the maintainer's usual workflow to identify the first **observed** failure, locate supporting upstream information and decide what to do. Do not assume failures are monotonic.
3. Repeat a comparable task using Oriclus, recording the same facts, elapsed time, human effort, Sandbox/test failures and any agent repair outcome. Counterbalance the order across participants where practical.
4. Ask which evidence changed the decision, what was confusing and whether they would use the tool again. Record negative feedback and uncertain results as well as successful outcomes.
5. Report denominators and the environment; avoid generalizing from a single case. Separately report cloud setup costs, Tavily use and model availability. A passing test is scoped to the command, versions and environment.
