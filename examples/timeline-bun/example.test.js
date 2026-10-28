import { expect, test } from "bun:test";
import semver from "semver";
import isNumber from "is-number";

test("compares semantic versions", () => {
  expect(semver.satisfies("1.2.3", "^1.0.0")).toBe(true);
  expect(isNumber("42")).toBe(true);
});
