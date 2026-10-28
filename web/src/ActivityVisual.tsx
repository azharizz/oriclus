import { useState, type CSSProperties } from "react";
import {
  Box,
  Check,
  FlaskConical,
  GitBranch,
  Search,
  Sparkles,
} from "lucide-react";
import { clock, useElapsed } from "./ui";

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
  cloning: "Fetching the recorded GitHub commit in the Sandbox",
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
  cloning: 0,
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
  const elapsed = useElapsed();
  const [lastStage, setLastStage] = useState(stage);
  const [trail, setTrail] = useState<{ stage: string; at: number }[]>([
    { stage, at: elapsed },
  ]);
  if (lastStage !== stage) {
    setLastStage(stage);
    setTrail([...trail, { stage, at: elapsed }].slice(-6));
  }
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
        ? [
            { name: "Fetch", icon: GitBranch },
            { name: "Read manifests", icon: Search },
            { name: "Release metadata", icon: Box },
          ]
        : [
            { name: "Snapshot", icon: GitBranch },
            { name: "Resolve", icon: Box },
            { name: "Inspect", icon: Search },
          ];
  const active =
    mode === "scan"
      ? // The scan request reports no stages; walk the steps by elapsed time
        // and say so in the note below.
        Math.min(2, Math.floor(elapsed / 4))
      : stage === "queued" || stage === "cancelling"
        ? -1
        : (group[stage] ?? -1);
  const fill = active < 0 ? 0 : active / Math.max(steps.length - 1, 1);

  return (
    <div
      className={`tm-activity mode-${mode} ${stage === "cancelling" ? "is-cancelling" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="tm-activity-head">
        <span className="tm-activity-live">
          <i className="live-dot" />
          {stage === "cancelling" ? "Stopping" : "Live"}
        </span>
        <strong key={stage} className="tm-activity-label">
          {labels[stage] || "Working"}
        </strong>
        <time className="tm-activity-clock" aria-label="Elapsed time">
          {clock(elapsed)}
        </time>
        {activity?.version && (
          <span className="tm-activity-version">
            <code>{activity.version}</code>
            {activity.index && activity.total ? (
              <span className="tm-activity-count">
                {activity.index} of {activity.total}
                <i aria-hidden="true">
                  <b
                    style={{
                      width: `${(100 * activity.index) / activity.total}%`,
                    }}
                  />
                </i>
              </span>
            ) : null}
          </span>
        )}
      </div>
      <div
        className="tm-activity-flow"
        aria-hidden="true"
        style={
          {
            "--fill": fill,
            "--steps": steps.length,
          } as CSSProperties
        }
      >
        <span className="tm-activity-rail">
          <i />
        </span>
        {steps.map(({ name, icon: Icon }, index) => (
          <div
            className={`tm-activity-step ${index === active ? "is-active" : index < active ? "is-done" : ""}`}
            key={name}
          >
            <span className="tm-activity-node">
              {index < active ? <Check size={15} /> : <Icon size={16} />}
            </span>
            <span>{name}</span>
          </div>
        ))}
      </div>
      <div className="tm-activity-scan" aria-hidden="true">
        <i />
      </div>
      {trail.length > 1 && (
        <ol className="tm-activity-trail" aria-label="Stages seen so far">
          {trail.map((item, index) => (
            <li
              key={`${item.stage}-${item.at}`}
              className={index === trail.length - 1 ? "is-current" : ""}
            >
              <time>{clock(item.at)}</time>
              {labels[item.stage] || item.stage.replaceAll("_", " ")}
            </li>
          ))}
        </ol>
      )}
      <p>
        {mode === "scan"
          ? "Steps advance with elapsed time while the project is read; they are not a completion estimate."
          : "The highlighted step reflects the current operation, not an estimated completion percentage."}
      </p>
    </div>
  );
}
