export type DecisionResult = {
  version?: string;
  combination?: Record<string, string>;
  status?: string;
  repair?: { status: string } | null;
  dependency_repair?: {
    status: string;
    combination?: Record<string, string>;
  } | null;
  dependency_repairs?: {
    status: string;
    combination?: Record<string, string>;
  }[];
};

type DecisionExperiment = {
  package: string;
  status: string;
  goal?: { package: string; version: string } | null;
  results: DecisionResult[];
};

type DecisionPackage = {
  name: string;
  current: string | null;
  requirement: string;
};

export type DecisionOption = {
  key: string;
  resultIndex: number;
  combination: Record<string, string>;
  outcome: "passed" | "repair" | "failed" | "inconclusive";
  dependencyRepairIndex?: number;
};

export function experimentOptions(run: DecisionExperiment): DecisionOption[] {
  return run.results.flatMap((result, resultIndex) => {
    const combination =
      result.combination ||
      (result.version ? { [run.package]: result.version } : {});
    if (!Object.keys(combination).length) return [];
    const option: DecisionOption = {
      key: `${resultIndex}:original`,
      resultIndex,
      combination,
      outcome:
        result.status === "passed"
          ? "passed"
          : result.status === "failed" && result.repair?.status === "verified"
            ? "repair"
            : result.status === "failed"
              ? "failed"
              : "inconclusive",
    };
    const repairs = result.dependency_repairs?.length
      ? result.dependency_repairs
      : result.dependency_repair
        ? [result.dependency_repair]
        : [];
    return [
      option,
      ...repairs.flatMap((repair, index): DecisionOption[] =>
        repair.status === "verified" &&
        repair.combination &&
        Object.keys(repair.combination).length
          ? [
              {
                key: `${resultIndex}:dependency:${index}`,
                resultIndex,
                combination: repair.combination,
                outcome: "repair",
                dependencyRepairIndex: index,
              },
            ]
          : [],
      ),
    ];
  });
}

export function recommendOptions(
  run: DecisionExperiment,
  packages: DecisionPackage[],
  options: DecisionOption[],
  manager = "",
) {
  if (run.status !== "completed")
    return { eligible: [], recommended: [], changes: null };
  const eligible = options.filter(
    (option) =>
      (option.outcome === "passed" || option.outcome === "repair") &&
      (!run.goal || option.combination[run.goal.package] === run.goal.version),
  );
  const counts = eligible.map((option) => {
    const entries = Object.entries(option.combination);
    const currents = entries.map(([name]) => {
      const item = packages.find((pkg) => pkg.name === name);
      const exact = item?.requirement.match(
        /^==([0-9][A-Za-z0-9._+!-]*)$/,
      )?.[1];
      const nodeExact = ["npm", "yarn", "pnpm", "bun"].includes(manager)
        ? item?.requirement.match(
            /^=?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9._+-]+)?)$/,
          )?.[1]
        : undefined;
      const cargoExact =
        manager === "cargo"
          ? item?.requirement.match(
              /^=([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9._+-]+)?)$/,
            )?.[1]
          : undefined;
      return item?.current || exact || nodeExact || cargoExact;
    });
    return currents.every(Boolean)
      ? entries.filter(([, version], i) => version !== currents[i]).length
      : null;
  });
  if (!eligible.length || counts.some((count) => count === null))
    return { eligible, recommended: [], changes: null };
  const changes = Math.min(...(counts as number[]));
  return {
    eligible,
    recommended: eligible.filter((_, i) => counts[i] === changes),
    changes,
  };
}
