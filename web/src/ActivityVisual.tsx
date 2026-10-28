import { Box, FlaskConical, GitBranch, Search, Sparkles } from "lucide-react";

export type Activity = {
  stage: string;
  version?: string | null;
  index?: number;
  total?: number;
};

const labels: Record<string, string> = {
  queued: "Waiting to start",
  scanning: "Reading project dependencies and release metadata",
  uploading: "Uploading the project snapshot",
  image: "Preparing the Sandbox base image",
  checkpoint: "Creating the shared filesystem checkpoint",
  resolving: "Running the package manager’s resolver",
  inspecting: "Checking dependency requirements and release metadata",
  explaining: "The configured model is explaining the resolver conflict",
  installing_baseline: "Installing the baseline dependencies",
  testing_baseline: "Running the baseline tests",
  installing_candidate: "Resolving and installing the selected version",
  checkpointing_candidate: "Saving the candidate checkpoint",
  testing_candidate: "Running the candidate tests",
  investigating:
    "The configured model is planning and investigating the failure",
  agent_tool: "Running an agent-requested command offline",
  reviewing: "Checking the proposed patch",
  verifying: "Verifying the patch in a fresh branch",
  dependency_planning: "Nemotron is proposing dependency version changes",
  dependency_research: "Researching public dependency release information",
  dependency_resolving: "Resolving the proposed dependency changes",
  dependency_installing: "Installing the proposed files in a fresh branch",
  dependency_verifying:
    "Running the original tests against the proposed dependencies",
  cancelling: "Requesting cancellation",
};

const group: Record<string, number> = {
  queued: 0,
  scanning: 0,
  uploading: 0,
  image: 0,
  checkpoint: 0,
  resolving: 1,
  inspecting: 2,
  explaining: 2,
  installing_baseline: 1,
  testing_baseline: 2,
  installing_candidate: 1,
  checkpointing_candidate: 1,
  testing_candidate: 2,
  investigating: 3,
  agent_tool: 3,
  reviewing: 3,
  verifying: 4,
  dependency_planning: 3,
  dependency_research: 3,
  dependency_resolving: 1,
  dependency_installing: 4,
  dependency_verifying: 4,
};

export default function ActivityVisual({
  activity,
  mode,
}: {
  activity?: Activity | null;
  mode: "scan" | "resolution" | "run";
}) {
  const stage = activity?.stage || "queued";
  const steps =
    mode === "run"
      ? [
          { name: "Snapshot", icon: GitBranch },
          { name: "Prepare", icon: Box },
          { name: "Test", icon: FlaskConical },
          { name: "Investigate", icon: Sparkles },
          { name: "Verify", icon: FlaskConical },
        ]
      : mode === "scan"
        ? [{ name: "Inspect", icon: Search }]
        : [
            { name: "Snapshot", icon: GitBranch },
            { name: "Resolve", icon: Box },
            { name: "Inspect", icon: Search },
          ];
  const active =
    stage === "queued" || stage === "cancelling" ? -1 : (group[stage] ?? -1);

  return (
    <div className="tm-activity" role="status" aria-live="polite">
      <div className="tm-activity-head">
        <span className="tm-activity-live">In progress</span>
        <strong>{labels[stage] || "Working"}</strong>
        {activity?.version && (
          <span>
            {activity.version}
            {activity.index && activity.total
              ? ` · ${activity.index} of ${activity.total}`
              : ""}
          </span>
        )}
      </div>
      <div className="tm-activity-flow" aria-hidden="true">
        {steps.map(({ name, icon: Icon }, index) => (
          <div
            className={`tm-activity-step ${index === active ? "is-active" : ""}`}
            key={name}
          >
            <span className="tm-activity-node">
              <Icon size={16} />
            </span>
            <span>{name}</span>
          </div>
        ))}
      </div>
      <p>
        The highlighted step reflects the current operation, not an estimated
        completion percentage.
      </p>
    </div>
  );
}
