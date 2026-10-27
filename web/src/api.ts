export type ConsumerSpec = {
  repository: string;
  ref: string;
  install_command: string;
  test_command: string;
  editable_paths: string[];
};
export type RunSpec = {
  title: string;
  upstream: string;
  baseline_ref: string;
  candidate_ref: string;
  package: string;
  repair_attempts: number;
  consumers: ConsumerSpec[];
};
export type DiscoverySpec = {
  upstream: string;
  baseline_ref: string;
  candidate_ref: string;
  consumers: string[];
};
export type Execution = {
  exit_code: number;
  output?: string;
  truncated: boolean;
};
export type Attempt = {
  number: number;
  status: string;
  explanation?: string | null;
  patch: string | null;
  verification: Execution | null;
  error: string | null;
  files?: string[];
};
export type Consumer = {
  index: number;
  repository: string;
  ref: string;
  commit?: string;
  status: string;
  baseline: Execution | null;
  candidate: Execution | null;
  attempts: Attempt[];
  error: string | null;
  selection: {
    candidate: number;
    rationale: string;
    remaining_risks?: string[];
  } | null;
};
export type Research = {
  query: string;
  status: string;
  error?: string;
  results: { title: string; url: string; content: string }[];
  request_id?: string;
  usage?: { credits?: number };
};
export type Proposal = {
  summary: string;
  versions: { baseline: string; candidate: string };
  evidence: {
    repository: string;
    ref: string;
    sha: string;
    path: string;
    excerpt: string;
    reason: string;
    url: string;
  }[];
  limitations: string[];
};
export type Run = {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  request: RunSpec;
  error: string | null;
  activity?: string;
  discovery?: DiscoverySpec;
  proposal?: Proposal;
  research_count?: number;
  consumers: Consumer[];
  upstream?: {
    baseline_sha: string;
    candidate_sha: string;
    diff_truncated?: boolean;
  };
  analysis: {
    summary?: string;
    changed_contracts?: string[];
    evidence_limits?: string[];
  } | null;
  assessment: {
    recommendation?: string;
    rationale?: string;
    limitations?: string[];
  } | null;
};
export type RunSummary = Pick<Run, "id" | "created_at" | "status"> & {
  request: Pick<
    RunSpec,
    "title" | "upstream" | "baseline_ref" | "candidate_ref"
  >;
  consumer_count: number;
};
export type RunEvent = { id: number; at: string; kind: string; title: string };
export type Page<T> = { items: T[]; total: number };
export type Health = {
  docker: boolean;
  image: boolean;
  model: string;
  inference_configured: boolean;
  tavily_configured: boolean;
  sandbox_configured: boolean;
  sandbox: string;
  active_run: { id: string; title: string; status: string } | null;
};

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail
          .map(
            (item: { loc: (string | number)[]; msg: string }) =>
              `${item.loc.slice(1).join(".")}: ${item.msg}`,
          )
          .join("; ")
      : data.detail;
    throw new Error(detail || `Request failed (${response.status}).`);
  }
  return data;
}
export const active = (status?: string) =>
  ["planning", "running", "queued"].includes(status || "");
export const repo = (url: string) => url.replace("https://github.com/", "");
export const shortRef = (ref: string) =>
  /^[a-f0-9]{40}$/.test(ref) ? ref.slice(0, 8) : ref;
export const pretty = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
const labels: Record<string, string> = {
  planning: "Finding a setup",
  ready: "Ready to start",
  repair_available: "Fix ready for review",
  baseline_failed: "Original tests failed",
  compatible: "Passed",
  regressed: "Breaking change",
  unevaluable: "Could not check",
  completed: "Finished",
  verifying: "Verifying",
  working: "Working",
  preparing: "Preparing",
  repairing: "Repairing",
  testing: "Testing",
  verified: "Passed",
  failed: "Failed",
  running: "Running",
  queued: "Waiting",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};
export const label = (status: string) => labels[status] || status;
