import { test } from "node:test";
import { strict as assert } from "node:assert";
import { experimentOptions, recommendOptions } from "../../web/src/decision.ts";

const packages = [
  { name: "a", current: "1", requirement: "1" },
  { name: "b", current: "1", requirement: "1" },
];
const experiment = {
  package: "a",
  status: "completed",
  goal: { package: "a", version: "2" },
  results: [
    {
      combination: { a: "2", b: "1" },
      status: "failed",
      repair: { status: "verified" },
    },
    { combination: { a: "2", b: "2" }, status: "passed" },
    { combination: { a: "1", b: "1" }, status: "passed" },
    { combination: { a: "2", b: "3" }, status: "inconclusive" },
  ],
};

test("recommends only goal-matching tested combinations with the fewest known changes", () => {
  const choices = recommendOptions(
    experiment,
    packages,
    experimentOptions(experiment),
  );
  assert.equal(choices.changes, 1);
  assert.equal(choices.recommended[0].outcome, "repair");
  assert.deepEqual(choices.recommended[0].combination, { a: "2", b: "1" });
  assert.equal(choices.eligible.length, 2);
});

test("unknown current versions and unfinished runs never produce a ranking", () => {
  assert.equal(
    recommendOptions(experiment, [], experimentOptions(experiment)).recommended
      .length,
    0,
  );
  assert.equal(
    recommendOptions(
      { ...experiment, status: "running" },
      packages,
      experimentOptions(experiment),
    ).recommended.length,
    0,
  );
});

test("dependency repairs rank the actually verified version set, not the original", () => {
  const run = {
    package: "a",
    status: "completed",
    results: [
      {
        combination: { a: "2", b: "1" },
        status: "failed",
        dependency_repairs: [
          { status: "verified", combination: { a: "2", b: "2" } },
        ],
      },
    ],
  };
  const options = experimentOptions(run);
  assert.equal(options[0].outcome, "failed");
  assert.deepEqual(options[1].combination, { a: "2", b: "2" });
  assert.deepEqual(
    recommendOptions(run, packages, options).recommended[0].combination,
    { a: "2", b: "2" },
  );
});

test("historical single-dependency results remain selectable", () => {
  assert.deepEqual(
    experimentOptions({
      package: "lib",
      status: "completed",
      results: [{ version: "3", status: "passed" }],
    })[0].combination,
    { lib: "3" },
  );
});

test("manager-specific requirement ranges are not treated as exact current versions", () => {
  const run = {
    package: "lib",
    status: "completed",
    results: [{ version: "2.0.0", status: "passed" }],
  };
  const options = experimentOptions(run);
  const noCurrent = (requirement) => [
    { name: "lib", current: null, requirement },
  ];
  assert.equal(
    recommendOptions(run, noCurrent("1.2"), options, "npm").changes,
    null,
  );
  assert.equal(
    recommendOptions(run, noCurrent("1.2.3"), options, "cargo").changes,
    null,
  );
  assert.equal(
    recommendOptions(run, noCurrent("1.2.3"), options, "npm").changes,
    1,
  );
  assert.equal(
    recommendOptions(run, noCurrent("=1.2.3"), options, "cargo").changes,
    1,
  );
});

test("never treats an inconclusive test as a passing source repair", () => {
  const run = {
    package: "lib",
    status: "completed",
    results: [
      { version: "2", status: "inconclusive", repair: { status: "verified" } },
    ],
  };
  assert.equal(experimentOptions(run)[0].outcome, "inconclusive");
});

test("returns every tied option and no recommendation for an unmet goal", () => {
  const run = {
    package: "a",
    status: "completed",
    goal: { package: "a", version: "2" },
    results: [
      { combination: { a: "2", b: "1" }, status: "passed" },
      {
        combination: { a: "2", b: "1" },
        status: "failed",
        repair: { status: "verified" },
      },
    ],
  };
  assert.equal(
    recommendOptions(run, packages, experimentOptions(run)).recommended.length,
    2,
  );
  const missed = { ...run, goal: { package: "a", version: "3" } };
  assert.equal(
    recommendOptions(missed, packages, experimentOptions(missed)).eligible
      .length,
    0,
  );
});
