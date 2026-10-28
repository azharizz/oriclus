import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  ChevronDown,
  Check,
  FlaskConical,
  FolderOpen,
  GitBranch,
  Globe,
  Info,
  Layers,
  History as HistoryIcon,
  LoaderCircle,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { api } from "./api";
import ActivityVisual, { type Activity } from "./ActivityVisual";
import { LogView, Pager, Skeleton } from "./ui";
import {
  experimentOptions,
  recommendOptions,
  type DecisionOption,
} from "./decision";
import "./timeline.css";

type Release = { version: string; date: string | null };
const ROW_HEIGHT = 90;
const ROWS_PER_PAGE = 20;
const dependencyKey = (name: string, ecosystem?: string) =>
  ecosystem === "python" ? name.toLowerCase().replace(/[-_.]+/g, "-") : name;
type Dependency = {
  name: string;
  requirement: string;
  current: string | null;
  direct: boolean;
  source?: string;
  marker?: string | null;
  metadata_error?: string;
  releases: Release[];
};
type Analysis = {
  id: string;
  source: string;
  project_name?: string;
  source_revision?: string | null;
  ecosystem: string;
  manager: string;
  packages: Dependency[];
  warnings: string[];
};
type Resolution = {
  status: "resolved" | "conflict" | "unsupported" | "error";
  selected: Record<string, string>;
  requirements: Record<string, string>;
  edges?: { source: string; target: string; requirement: string }[];
  message: string;
  packages?: Dependency[];
  explanation_status?: "completed" | "unavailable" | "not_requested";
  explanation?: {
    summary: string;
    suggestions: string[];
    limitations: string[];
  } | null;
};
type Result = {
  version?: string;
  combination?: Record<string, string>;
  resolution_status?: "succeeded" | "failed_or_inconclusive";
  repair_pending?: boolean;
  dependency_repair?: {
    status: string;
    explanation: string | null;
    changes: { package: string; version: string }[];
    research?: { title: string; url: string; content: string }[];
    combination?: Record<string, string>;
    patch: string | null;
    error: string | null;
    verification: Result | null;
    independent_installation?: Result | null;
  } | null;
  dependency_repairs?: NonNullable<Result["dependency_repair"]>[];
  status?: string;
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  timed_out?: boolean;
  installation?: {
    exit_code?: number | null;
    stdout?: string;
    stderr?: string;
    timed_out?: boolean;
  };
  operation_id?: string;
  image_id?: string;
  error?: string;
  explanation?: string | null;
  repair?: {
    status: "verified" | "failed" | "rejected" | "unavailable";
    patch: string | null;
    explanation: string | null;
    verification: Result | null;
    error: string | null;
  } | null;
};
type Experiment = {
  id: string;
  analysis_id: string;
  status: string;
  package: string;
  goal?: { package: string; version: string } | null;
  test_command: string;
  baseline?: Result | null;
  results: Result[];
  error?: string | null;
  activity?: Activity | null;
  model?: string;
  activity_history?: { stage: string; version: string | null; at: number }[];
  agent_decisions?: AgentDecision[];
};
type RecentExperiment = {
  id: string;
  analysis_id: string;
  package: string;
  versions: string[];
  status: string;
};
type ResearchEntry = {
  package: string;
  version: string | null;
  searched_at: string;
  summary?: {
    status: string;
    findings: { category: string; summary: string; source_urls: string[] }[];
    limitations: string[];
  };
  sources: {
    title: string;
    url: string;
    content: string;
    published_date?: string | null;
  }[];
};
type AgentDecision = {
  kind: string;
  version: string;
  at: number;
  turn?: number;
  goal?: string;
  steps?: string[];
  limitations?: string[];
  text?: string;
  tool?: string;
  input?: string;
  exit_code?: number | null;
  error?: string | null;
  tool_count?: number;
};
type Selection = { name: string; version: string };
const tabs = ["overview", "resolve", "test"] as const;

function dateValue(value: string | null) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

function resultLabel(status: string) {
  return (
    (
      {
        passed: "Tests passed",
        failed: "Tests failed",
        inconclusive: "Inconclusive",
        cancelled: "Cancelled",
        cancelling: "Cancelling",
        running: "Running",
        completed: "Completed",
        queued: "Queued",
        verified: "Repair verified",
        rejected: "Repair rejected",
        unavailable: "Repair unavailable",
      } as Record<string, string>
    )[status] || status
  );
}

function resultClass(status: string) {
  return status === "passed"
    ? "pass"
    : status === "failed"
      ? "fail"
      : "unknown";
}

export default function Timeline({
  onAnalysis,
  target,
  initialRunId,
}: {
  onAnalysis: (id: string) => void;
  target: { id: string; package: string; version: string } | null;
  initialRunId?: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [decisionKey, setDecisionKey] = useState<string | null>(null);
  const [focusDecision, setFocusDecision] = useState(false);
  const [source, setSource] = useState<"github" | "local">("github");
  const [location, setLocation] = useState("");
  const [directory, setDirectory] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [queued, setQueued] = useState<Selection[]>([]);
  const [goalChoice, setGoalChoice] = useState("");
  const [allowDependencyRepair, setAllowDependencyRepair] = useState(true);
  const [showTransitive, setShowTransitive] = useState(true);
  const [rowPage, setRowPage] = useState(0);
  const [dependencyFilter, setDependencyFilter] = useState("");
  const [zoom, setZoom] = useState(1);
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    name: string;
    version: string;
    date: number;
    status: string;
    researched: boolean;
  } | null>(null);
  const [testCommand, setTestCommand] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runError, setRunError] = useState("");
  const [recentLimit, setRecentLimit] = useState(10);
  const [tab, setTab] = useState<(typeof tabs)[number]>("overview");
  const sourceRef = useRef<HTMLFormElement>(null);
  const resultsRef = useRef<HTMLElement>(null);

  const incomingRun = useQuery({
    queryKey: ["timeline-run", initialRunId],
    queryFn: () =>
      api<Experiment>(`/timeline/runs/${encodeURIComponent(initialRunId!)}`),
    enabled: !!initialRunId && !target,
    retry: false,
  });
  const incomingAnalysisId = target?.id || incomingRun.data?.analysis_id;
  const incomingAnalysis = useQuery({
    queryKey: ["timeline-incoming-analysis", incomingAnalysisId],
    queryFn: () =>
      api<Analysis>(
        `/timeline/analyses/${encodeURIComponent(incomingAnalysisId!)}`,
      ),
    enabled: !!incomingAnalysisId,
    retry: false,
  });
  const incomingKey = target
    ? JSON.stringify(["target", target.id, target.package, target.version])
    : initialRunId
      ? `run:${initialRunId}`
      : null;
  const [appliedIncoming, setAppliedIncoming] = useState<string | null>(null);
  if (
    incomingKey &&
    incomingAnalysis.data &&
    appliedIncoming !== incomingKey &&
    (target || incomingRun.data)
  ) {
    setAppliedIncoming(incomingKey);
    setAnalysis(incomingAnalysis.data);
    setDependencyFilter("");
    if (target) {
      setShowTransitive(true);
      setRowPage(
        Math.max(
          0,
          Math.floor(
            incomingAnalysis.data.packages.findIndex(
              (pkg) => pkg.name === target.package,
            ) / ROWS_PER_PAGE,
          ),
        ),
      );
      setSelection({ name: target.package, version: target.version });
    } else if (incomingRun.data) {
      setRowPage(0);
      setSelection(null);
      setRunId(incomingRun.data.id);
      setTestCommand(incomingRun.data.test_command);
    }
  }
  const incomingError = target
    ? incomingAnalysis.error
    : incomingRun.error || incomingAnalysis.error;
  const attachScroll = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      if (node && analysis) node.scrollLeft = node.scrollWidth;
    },
    [analysis?.id],
  );

  const recent = useQuery({
    queryKey: ["timeline-recent", recentLimit],
    queryFn: () =>
      api<RecentExperiment[]>(`/timeline/runs?limit=${recentLimit}`),
    refetchInterval: 15000,
    placeholderData: (previous) => previous,
  });

  const resolutionProgressId = useMemo(
    () => crypto.randomUUID().replaceAll("-", ""),
    [analysis?.id, selection?.name, selection?.version],
  );
  const resolution = useQuery({
    queryKey: [
      "timeline-resolution",
      analysis?.id,
      selection?.name,
      selection?.version,
    ],
    queryFn: () =>
      api<Resolution>("/timeline/resolve", {
        id: analysis!.id,
        package: selection!.name,
        version: selection!.version,
        progress_id: resolutionProgressId,
      }),
    enabled: !!analysis && !!selection,
    retry: false,
    staleTime: Infinity,
  });
  const resolutionActivity = useQuery({
    queryKey: ["resolution-progress", resolutionProgressId],
    queryFn: () =>
      api<Activity>(`/timeline/resolution-progress/${resolutionProgressId}`),
    enabled: !!analysis && !!selection && resolution.isFetching,
    refetchInterval: 700,
    retry: false,
  });
  const research = useQuery({
    queryKey: ["timeline-research", analysis?.id],
    queryFn: () => api<ResearchEntry[]>(`/timeline/research/${analysis!.id}`),
    enabled: !!analysis,
    refetchInterval: 10000,
    retry: false,
  });
  const run = useQuery({
    queryKey: ["timeline-run", runId],
    queryFn: () =>
      api<Experiment>(`/timeline/runs/${encodeURIComponent(runId!)}`),
    enabled: !!runId,
    refetchInterval: (query) =>
      ["queued", "running", "preparing", "testing", "cancelling"].includes(
        query.state.data?.status || "",
      )
        ? 1500
        : false,
    retry: false,
  });

  const researched = useMemo(
    () =>
      new Set(
        (research.data || [])
          .filter((entry) => entry.version && entry.sources.length)
          .map((entry) => JSON.stringify([entry.package, entry.version])),
      ),
    [research.data],
  );
  const packages = useMemo(() => {
    const initial = analysis?.packages || [];
    const known = new Set(
      initial.map((item) => dependencyKey(item.name, analysis?.ecosystem)),
    );
    return [
      ...initial,
      ...(resolution.data?.packages || []).filter(
        (item) => !known.has(dependencyKey(item.name, analysis?.ecosystem)),
      ),
    ];
  }, [analysis, resolution.data]);
  const activeExperiment =
    run.data?.analysis_id === analysis?.id ? run.data : undefined;
  const options = activeExperiment ? experimentOptions(activeExperiment) : [];
  const selectedDecision = options.find((option) => option.key === decisionKey);
  const decisionResult =
    selectedDecision && activeExperiment?.results[selectedDecision.resultIndex];
  const recommendation = activeExperiment
    ? recommendOptions(
        activeExperiment,
        analysis?.packages || [],
        options,
        analysis?.manager,
      )
    : { eligible: [], recommended: [], changes: null };
  const decisionNames = new Set(
    Object.keys(selectedDecision?.combination || {}).map((name) =>
      dependencyKey(name, analysis?.ecosystem),
    ),
  );

  const decisionScope = `${runId || ""}:${analysis?.id || ""}`;
  const [previousDecisionScope, setPreviousDecisionScope] =
    useState(decisionScope);
  if (decisionScope !== previousDecisionScope) {
    setPreviousDecisionScope(decisionScope);
    setDecisionKey(null);
    setFocusDecision(false);
  }

  const dates = useMemo(
    () =>
      packages.flatMap((pkg) =>
        pkg.releases
          .map((release) => dateValue(release.date))
          .filter((date): date is number => date !== null),
      ),
    [packages],
  );
  const minDate = dates.reduce(
    (lowest, date) => Math.min(lowest, date),
    dates[0] ?? 0,
  );
  const maxDate = dates.reduce(
    (highest, date) => Math.max(highest, date),
    dates[0] ?? 0,
  );
  const yearStart = dates.length ? new Date(minDate).getUTCFullYear() : 0;
  const yearEnd = dates.length ? new Date(maxDate).getUTCFullYear() : 0;
  const start = dates.length ? Date.UTC(yearStart, 0, 1) : 0;
  const end = dates.length ? Date.UTC(yearEnd + 1, 0, 1) : 1;
  const timelineWidth = Math.max(
    900,
    Math.min(20000, (yearEnd - yearStart + 1) * 185 * zoom),
  );
  const position = (date: number) =>
    ((date - start) / (end - start)) * timelineWidth;
  const years = dates.length
    ? Array.from({ length: yearEnd - yearStart + 1 }, (_, i) => yearStart + i)
    : [];
  const months =
    timelineWidth / Math.max(years.length, 1) >= 330
      ? Array.from({ length: 12 }, (_, i) => i)
      : [0, 3, 6, 9];
  const monthLabel = (month: number) =>
    months.length === 12
      ? new Intl.DateTimeFormat(undefined, {
          month: "short",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(2024, month, 1)))
      : `Q${month / 3 + 1}`;
  const filteredPackages = packages.filter(
    (pkg) =>
      (pkg.direct ||
        showTransitive ||
        (focusDecision &&
          decisionNames.has(dependencyKey(pkg.name, analysis?.ecosystem)))) &&
      (!focusDecision ||
        !selectedDecision ||
        decisionNames.has(dependencyKey(pkg.name, analysis?.ecosystem))) &&
      pkg.name.toLowerCase().includes(dependencyFilter.trim().toLowerCase()),
  );
  const activeRowPage = Math.min(
    rowPage,
    Math.max(0, Math.ceil(filteredPackages.length / ROWS_PER_PAGE) - 1),
  );
  const visible = filteredPackages.slice(
    activeRowPage * ROWS_PER_PAGE,
    (activeRowPage + 1) * ROWS_PER_PAGE,
  );
  const resolvedVersions = new Map(
    Object.entries(resolution.data?.selected || {}).map(([name, version]) => [
      dependencyKey(name, analysis?.ecosystem),
      version,
    ]),
  );
  const resolvePoint = (name: string) => {
    const index = visible.findIndex(
      (pkg) =>
        dependencyKey(pkg.name, analysis?.ecosystem) ===
        dependencyKey(name, analysis?.ecosystem),
    );
    if (index < 0 || !resolution.data) return null;
    const selected = resolvedVersions.get(
      dependencyKey(name, analysis?.ecosystem),
    );
    const date = dateValue(
      visible[index].releases.find((release) => release.version === selected)
        ?.date || null,
    );
    return date === null
      ? null
      : { x: position(date), y: index * ROW_HEIGHT + ROW_HEIGHT / 2 };
  };
  const resolvedEdges =
    !selectedDecision && resolution.data?.status === "resolved"
      ? (resolution.data.edges || []).flatMap((edge) => {
          const source = resolvePoint(edge.source),
            target = resolvePoint(edge.target);
          return source && target
            ? [{ ...edge, from: source, to: target }]
            : [];
        })
      : [];
  const selectedPackage = packages.find((pkg) => pkg.name === selection?.name);
  const selections = queued.reduce<Record<string, string[]>>((groups, item) => {
    (groups[item.name] ||= []).push(item.version);
    return groups;
  }, {});
  const combinationCount = Object.values(selections).reduce(
    (count, versions) => count * versions.length,
    queued.length ? 1 : 0,
  );
  const undated =
    selectedPackage?.releases.filter(
      (release) => dateValue(release.date) === null,
    ) || [];

  async function analyze(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    setAnalysis(null);
    setRowPage(0);
    setDependencyFilter("");
    setSelection(null);
    setQueued([]);
    setGoalChoice("");
    setRunId(null);
    setRunError("");
    try {
      const result = await api<Analysis>("/timeline/analyze", {
        source,
        location: location.trim(),
        directory: directory.trim(),
      });
      setAnalysis(result);
      onAnalysis(result.id);
      setTestCommand(
        result.manager === "bun"
          ? "bun test"
          : result.ecosystem === "go"
            ? "go test ./..."
            : result.ecosystem === "rust"
              ? "cargo test --offline --locked"
              : result.ecosystem === "python"
                ? "python -m pytest"
                : result.ecosystem === "node"
                  ? "npm test"
                  : "",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not inspect this project.",
      );
    } finally {
      setLoading(false);
    }
  }

  function inspectDecision(option: DecisionOption) {
    setDecisionKey(option.key);
    setFocusDecision(true);
    setDependencyFilter("");
    setRowPage(0);
    setSelection(null);
    const firstDate = Object.entries(option.combination)
      .map(([name, version]) =>
        dateValue(
          packages
            .find(
              (pkg) =>
                dependencyKey(pkg.name, analysis?.ecosystem) ===
                dependencyKey(name, analysis?.ecosystem),
            )
            ?.releases.find((release) => release.version === version)?.date ||
            null,
        ),
      )
      .find((value) => value !== null);
    requestAnimationFrame(() => {
      timelineRef.current?.scrollIntoView({ block: "start" });
      if (firstDate != null && scrollRef.current)
        scrollRef.current.scrollTo({
          left: Math.max(
            0,
            210 + position(firstDate) - scrollRef.current.clientWidth / 2,
          ),
        });
    });
  }

  function choose(name: string, version: string) {
    setSelection({ name, version });
    const release = packages
      .find((pkg) => pkg.name === name)
      ?.releases.find((item) => item.version === version);
    const date = dateValue(release?.date || null);
    if (date !== null && scrollRef.current) {
      scrollRef.current.scrollTo({
        left: Math.max(
          0,
          210 + position(date) - scrollRef.current.clientWidth / 2,
        ),
      });
    }
    setRunError("");
  }

  function toggleVersion(version: string) {
    if (!selection) return;
    setQueued((current) =>
      current.some(
        (item) => item.name === selection.name && item.version === version,
      )
        ? current.filter(
            (item) => item.name !== selection.name || item.version !== version,
          )
        : current.filter((item) => item.name === selection.name).length < 5 &&
            (current.some((item) => item.name === selection.name) ||
              new Set(current.map((item) => item.name)).size < 5)
          ? [...current, { name: selection.name, version }]
          : current,
    );
  }

  async function startRun() {
    if (
      !analysis ||
      !selection ||
      !queued.length ||
      combinationCount > 12 ||
      !testCommand.trim()
    )
      return;
    setSubmitting(true);
    setRunError("");
    try {
      const created = await api<Experiment>("/timeline/runs", {
        analysis_id: analysis.id,
        package: queued[0].name,
        versions: selections[queued[0].name],
        selections,
        dependency_repair:
          allowDependencyRepair &&
          !["bun", "go", "cargo"].includes(analysis.manager),
        goal: queued.find((item) => JSON.stringify(item) === goalChoice)
          ? {
              package: JSON.parse(goalChoice).name,
              version: JSON.parse(goalChoice).version,
            }
          : null,
        test_command: testCommand.trim(),
      });
      setRunId(created.id);
      await recent.refetch();
    } catch (err) {
      setRunError(
        err instanceof Error ? err.message : "Could not start this experiment.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function openRecent(item: RecentExperiment) {
    setError("");
    try {
      const [saved, experiment] = await Promise.all([
        api<Analysis>(
          `/timeline/analyses/${encodeURIComponent(item.analysis_id)}`,
        ),
        api<Experiment>(`/timeline/runs/${encodeURIComponent(item.id)}`),
      ]);
      setAnalysis(saved);
      setRowPage(0);
      setDependencyFilter("");
      onAnalysis(saved.id);
      setSelection(null);
      setQueued([]);
      setRunId(item.id);
      setTestCommand(experiment.test_command);
      setRunError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not open this experiment.",
      );
    }
  }

  async function cancelRun() {
    if (!runId) return;
    try {
      await api(`/timeline/runs/${encodeURIComponent(runId)}/cancel`, {});
      await run.refetch();
    } catch (err) {
      setRunError(
        err instanceof Error
          ? err.message
          : "Could not cancel this experiment.",
      );
    }
  }

  return (
    <section className="time-machine">
      {tip && (
        <div
          className="tm-tooltip"
          id="release-tooltip"
          role="tooltip"
          style={{ left: tip.x, top: tip.y }}
        >
          <strong>
            {tip.name} {tip.version}
          </strong>
          <span>
            Released{" "}
            {new Intl.DateTimeFormat(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "UTC",
            }).format(new Date(tip.date))}
          </span>
          <span>{tip.status}</span>
          {tip.researched && <span>Research available</span>}
          <small>Select to inspect this release</small>
        </div>
      )}
      <header className="tm-heading">
        <div>
          <h1>Dependency time machine</h1>
          <p>
            Explore releases, resolve a version, and test the combination before
            you upgrade.
          </p>
        </div>
        <ol className="tm-stepper" aria-label="Progress">
          {[
            {
              name: "Choose project",
              detail: analysis?.project_name || "Repository or folder",
              state: analysis ? "done" : "active",
              target: sourceRef,
            },
            {
              name: "Explore & resolve",
              detail: selection
                ? `${selection.name} ${selection.version}`
                : analysis
                  ? `${packages.length} dependencies`
                  : "Release timeline",
              state: runId ? "done" : analysis ? "active" : "todo",
              target: timelineRef,
            },
            {
              name: "Test in Sandbox",
              detail: run.data
                ? resultLabel(run.data.status)
                : queued.length
                  ? `${queued.length} version${queued.length === 1 ? "" : "s"} queued`
                  : "Optional",
              state: runId ? "active" : "todo",
              target: resultsRef,
            },
          ].map((step, index) => (
            <li key={step.name} className={`is-${step.state}`}>
              <button
                type="button"
                disabled={step.state === "todo"}
                aria-current={step.state === "active" ? "step" : undefined}
                onClick={() =>
                  step.target.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                <span className="tm-stepper-node">
                  {step.state === "done" ? <Check size={14} /> : index + 1}
                </span>
                <span>
                  <strong>{step.name}</strong>
                  <small>{step.detail}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </header>
      <form className="tm-source" onSubmit={analyze} ref={sourceRef}>
        <div className="tm-source-heading">
          <div>
            <span className="tm-step">01</span>
            <strong>Choose a project</strong>
          </div>
          <small>Inspect dependencies before running code</small>
        </div>
        <div className="tm-source-fields">
          <fieldset
            className="tm-segment"
            style={{ "--seg": source === "github" ? 0 : 1 } as CSSProperties}
          >
            <legend>Source</legend>
            <span className="tm-segment-thumb" aria-hidden="true" />
            {(
              [
                ["github", "Public GitHub", Globe],
                ["local", "Local directory", FolderOpen],
              ] as const
            ).map(([value, text, Icon]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="tm-source"
                  value={value}
                  checked={source === value}
                  onChange={() => setSource(value)}
                />
                <Icon size={14} /> {text}
              </label>
            ))}
          </fieldset>
          <label className="tm-location">
            {source === "github" ? "Repository URL" : "Absolute directory path"}
            <span className="tm-location-field">
              {source === "github" ? (
                <GitBranch size={15} aria-hidden="true" />
              ) : (
                <FolderOpen size={15} aria-hidden="true" />
              )}
              <input
                required
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder={
                  source === "github"
                    ? "https://github.com/owner/repository"
                    : "/path/to/your/project"
                }
              />
            </span>
          </label>
          <button className="primary" disabled={loading || !location.trim()}>
            {loading ? (
              <>
                <LoaderCircle className="tm-spinner" size={15} /> Inspecting
              </>
            ) : (
              <>
                Explore versions <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
        <details className="tm-project-scope">
          <summary>Use a project subdirectory</summary>
          <label>
            Relative project directory
            <input
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              placeholder="e.g. packages/frontend"
            />
          </label>
          <p>
            Only this directory is saved for the experiment. Parent workspace
            files and sibling projects are excluded, so projects that need them
            may not work. For GitHub, the repository is fetched in the Sandbox
            before this directory is selected.
          </p>
        </details>
        <p className="tm-source-note">
          Resolving or testing sends local project files or fetches the recorded
          public GitHub commit in Nebius Sandboxes. Failed test output and
          relevant source may be sent to Nemotron. Review your files and command
          before continuing.
        </p>
        {loading && (
          <ActivityVisual mode="scan" activity={{ stage: "scanning" }} />
        )}
        {(error || incomingError) && (
          <p role="alert" className="error">
            {error || incomingError?.message}
          </p>
        )}
      </form>
      {!!recent.data?.length && (
        <details className="tm-recent">
          <summary>
            <HistoryIcon size={15} /> Recent Sandbox experiments
            <span className="tm-count">{recent.data.length}</span>
            <ChevronDown size={14} className="tm-chevron" />
          </summary>
          <div className="tm-recent-list">
            {recent.data.map((item) => (
              <button
                key={item.id}
                type="button"
                className={runId === item.id ? "is-open" : ""}
                onClick={() => openRecent(item)}
              >
                <i
                  className={`tm-result-dot ${["queued", "running", "preparing", "testing"].includes(item.status) ? "live" : item.status === "completed" ? "done" : resultClass(item.status)}`}
                />
                <strong>{item.package}</strong>
                <span className="tm-recent-versions">
                  {item.versions.map((version) => (
                    <code key={version}>{version}</code>
                  ))}
                </span>
                <span className="tm-recent-status">
                  {resultLabel(item.status)}
                </span>
                <span className="tm-recent-id">#{item.id.slice(0, 8)}</span>
              </button>
            ))}
            {recent.data.length >= recentLimit && recentLimit < 100 && (
              <button
                type="button"
                onClick={() =>
                  setRecentLimit((value) => Math.min(100, value + 10))
                }
              >
                Show more experiments
              </button>
            )}
          </div>
        </details>
      )}
      {!analysis ? (
        <div className="tm-intro">
          <div className="tm-hero-preview" aria-hidden="true">
            {[
              [8, 22, 41, 63, 80],
              [15, 34, 52, 71, 92],
              [5, 28, 47, 88],
            ].map((dots, row) => (
              <div className="tm-hero-row" key={row}>
                <span className="tm-hero-label">
                  <i />
                  <i />
                </span>
                <span className="tm-hero-track">
                  {dots.map((left, index) => (
                    <i
                      key={left}
                      className={
                        row === 1 && index === 3
                          ? "is-selected"
                          : index === dots.length - 1
                            ? "is-latest"
                            : row === 0 && index === 2
                              ? "is-current"
                              : ""
                      }
                      style={
                        {
                          left: `${left}%`,
                          "--d": row * 5 + index,
                        } as CSSProperties
                      }
                    />
                  ))}
                </span>
              </div>
            ))}
            <span className="tm-hero-sweep" />
          </div>
          <div className="tm-intro-title">
            <GitBranch size={18} />
            <div>
              <strong>From release history to real evidence</strong>
              <p>
                Start with a project to see its dependencies in one timeline.
              </p>
            </div>
          </div>
          <div className="tm-intro-steps">
            <div>
              <span>
                <CalendarDays size={15} /> 01
              </span>
              <strong>Explore</strong>
              <p>Compare release dates and requirements.</p>
            </div>
            <div>
              <span>
                <Search size={15} /> 02
              </span>
              <strong>Resolve</strong>
              <p>See a candidate set using the project’s package manager.</p>
            </div>
            <div>
              <span>
                <FlaskConical size={15} /> 03
              </span>
              <strong>Test</strong>
              <p>Run selected versions in separate Sandbox experiments.</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {analysis.warnings?.length > 0 && (
            <div className="tm-warnings" role="status">
              {analysis.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          )}
          <div className="tm-workspace-head" ref={timelineRef}>
            <div>
              <span className="tm-step">02</span>
              <h2>Release timeline</h2>
              <p>
                {analysis.project_name && (
                  <>
                    {analysis.project_name} <span>·</span>{" "}
                  </>
                )}
                {analysis.ecosystem} <span>·</span> {analysis.manager}{" "}
                <span>·</span> {packages.filter((item) => item.direct).length}{" "}
                direct · {packages.filter((item) => !item.direct).length}{" "}
                related
                {analysis.source_revision && (
                  <>
                    {" "}
                    <span>·</span> commit{" "}
                    <code>{analysis.source_revision.slice(0, 12)}</code>
                  </>
                )}
              </p>
            </div>
            <div className="tm-tools">
              <input
                type="search"
                className="tm-dependency-filter"
                aria-label="Filter dependencies"
                placeholder="Find dependency"
                value={dependencyFilter}
                onChange={(event) => {
                  setDependencyFilter(event.target.value);
                  setRowPage(0);
                }}
              />
              <label className="tm-check">
                <input
                  type="checkbox"
                  checked={showTransitive}
                  onChange={(event) => {
                    setShowTransitive(event.target.checked);
                    setRowPage(0);
                  }}
                />{" "}
                Show related dependencies
              </label>
              <button
                type="button"
                className="tm-jump"
                onClick={() => scrollRef.current?.scrollTo({ left: 0 })}
              >
                Oldest
              </button>
              <button
                type="button"
                className="tm-jump"
                onClick={() =>
                  scrollRef.current?.scrollTo({
                    left: scrollRef.current.scrollWidth,
                  })
                }
              >
                Latest
              </button>
              <label>
                Scale{" "}
                <select
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                >
                  <option value={0.6}>Compact</option>
                  <option value={1}>Standard</option>
                  <option value={2}>Expanded</option>
                </select>
              </label>
            </div>
          </div>
          {selectedDecision && decisionResult && activeExperiment && (
            <section
              className="tm-decision"
              aria-label="Selected combination evidence"
              aria-live="polite"
            >
              <div className="tm-decision-head">
                <div>
                  <h3>Selected experiment combination</h3>
                  <p>
                    {selectedDecision.outcome === "passed"
                      ? "Tests passed"
                      : selectedDecision.outcome === "repair"
                        ? "Passed after a verified repair"
                        : selectedDecision.outcome === "failed"
                          ? "Tests failed"
                          : "Not tested or inconclusive"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDecisionKey(null);
                    setFocusDecision(false);
                  }}
                >
                  Clear selection
                </button>
              </div>
              <ul className="tm-decision-versions">
                {Object.entries(selectedDecision.combination).map(
                  ([name, version]) => {
                    const pkg = packages.find(
                      (item) =>
                        dependencyKey(item.name, analysis.ecosystem) ===
                        dependencyKey(name, analysis.ecosystem),
                    );
                    const release = pkg?.releases.find(
                      (item) => item.version === version,
                    );
                    return (
                      <li key={name}>
                        <strong>{name}</strong> <span>{version}</span>
                        {!release && <small>Not on timeline</small>}
                        {release && !release.date && (
                          <small>Date unknown</small>
                        )}
                      </li>
                    );
                  },
                )}
              </ul>
              <label className="tm-check">
                <input
                  type="checkbox"
                  checked={focusDecision}
                  onChange={(event) => {
                    setFocusDecision(event.target.checked);
                    setRowPage(0);
                  }}
                />{" "}
                Focus on this combination
              </label>
              <p className="tm-limit">
                This result applies to the complete combination and the recorded
                test command. Highlighting a version does not mean it passes
                with other versions.
              </p>
              <details className="tm-command">
                <summary>View test command</summary>
                <code>{activeExperiment.test_command}</code>
              </details>
              <ResultCard
                key={`${activeExperiment.id}-${selectedDecision.key}`}
                title="Review test evidence and proposed patches"
                result={decisionResult}
              />
              {selectedDecision.dependencyRepairIndex !== undefined && (
                <p className="tm-limit">
                  This selection shows the versions from verified dependency
                  proposal {selectedDecision.dependencyRepairIndex + 1}. Open
                  that proposal above to review its patch and independent
                  verification.
                </p>
              )}
            </section>
          )}
          <div className="tm-legend">
            <span>
              <i className="tm-key current" /> Current
            </span>
            <span>
              <i className="tm-key selected" /> Selected
            </span>
            <span>
              <i className="tm-key resolved" /> Resolver selected
            </span>
            {resolvedEdges.length > 0 && (
              <span>
                <i className="tm-connection-key" /> Declared dependency
              </span>
            )}
            <span>
              <i className="tm-key release" /> Available, not in this experiment
            </span>
            {options.length > 0 && (
              <span>
                <i className="tm-key experiment" /> Appears in an experiment
              </span>
            )}
            {selectedDecision && (
              <span>
                <i className="tm-key decision" /> Selected combination
              </span>
            )}
            <span>
              <i className="tm-key research" /> Research available
            </span>
            <span className="tm-legend-note">
              Release positions use publication dates. Select a point for
              details.
            </span>
          </div>
          <div className="tm-layout">
            <div className="tm-chart-wrap">
              <div
                className="tm-scroll"
                ref={attachScroll}
                role="region"
                aria-label="Dependency release timeline, scroll horizontally to explore"
                tabIndex={0}
                onScroll={() => setTip(null)}
              >
                <div
                  className="tm-grid"
                  style={
                    {
                      width: `calc(${timelineWidth}px + var(--tm-label-width))`,
                      "--tm-row-height": `${ROW_HEIGHT}px`,
                    } as CSSProperties
                  }
                >
                  <div className="tm-axis">
                    <div className="tm-axis-label">
                      DEPENDENCY <span>{filteredPackages.length}</span>
                    </div>
                    <div
                      className="tm-axis-years"
                      style={{ width: timelineWidth }}
                    >
                      {years.map((year) => (
                        <span
                          className="tm-year-label"
                          key={year}
                          style={{ left: position(Date.UTC(year, 0, 1)) + 5 }}
                        >
                          {year}
                        </span>
                      ))}
                      {years.flatMap((year) =>
                        months.map((month) => (
                          <span
                            className="tm-month-label"
                            key={`${year}-${month}`}
                            style={{
                              left: position(Date.UTC(year, month, 1)) + 5,
                            }}
                          >
                            {monthLabel(month)}
                          </span>
                        )),
                      )}
                    </div>
                  </div>
                  {resolvedEdges.length > 0 && (
                    <svg
                      className="tm-connections"
                      width={timelineWidth}
                      height={visible.length * ROW_HEIGHT}
                      aria-hidden="true"
                    >
                      {resolvedEdges.map((edge, index) => (
                        <line
                          key={`${edge.source}-${edge.target}-${index}`}
                          x1={edge.from.x}
                          y1={edge.from.y}
                          x2={edge.to.x}
                          y2={edge.to.y}
                        />
                      ))}
                    </svg>
                  )}
                  {visible.map((pkg, rowIndex) => (
                    <div
                      className={`tm-row ${selection?.name === pkg.name ? "is-selected-row" : ""}`}
                      key={pkg.name}
                      style={{ "--r": rowIndex } as CSSProperties}
                    >
                      <div className="tm-package">
                        <strong title={pkg.name}>{pkg.name}</strong>
                        <span>
                          {pkg.current
                            ? `Current ${pkg.current}`
                            : "Current unknown"}{" "}
                          {!pkg.direct &&
                            (pkg.source?.startsWith("registry metadata:")
                              ? " · declared relation"
                              : " · transitive")}
                        </span>
                        {pkg.metadata_error && (
                          <small
                            className="tm-metadata-error"
                            title={pkg.metadata_error}
                          >
                            Release metadata unavailable
                          </small>
                        )}
                        <select
                          aria-label={`Choose a ${pkg.name} release`}
                          value={
                            selection?.name === pkg.name
                              ? selection.version
                              : ""
                          }
                          onChange={(event) => {
                            if (event.target.value)
                              choose(pkg.name, event.target.value);
                          }}
                        >
                          <option value="">Browse releases</option>
                          {[...pkg.releases]
                            .sort((a, b) => {
                              const first = dateValue(a.date);
                              const second = dateValue(b.date);
                              return first === null
                                ? second === null
                                  ? a.version.localeCompare(
                                      b.version,
                                      undefined,
                                      { numeric: true },
                                    )
                                  : 1
                                : second === null
                                  ? -1
                                  : first - second;
                            })
                            .map((release, index) => (
                              <option
                                key={`${release.version}-${index}`}
                                value={release.version}
                              >
                                {release.version}
                                {dateValue(release.date) !== null
                                  ? ` · ${new Date(release.date!).toLocaleDateString()}`
                                  : " · date unknown"}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div
                        className="tm-track"
                        style={{ width: timelineWidth }}
                      >
                        {years.map((year) => (
                          <i
                            key={year}
                            className="tm-year-line"
                            style={{ left: position(Date.UTC(year, 0, 1)) }}
                          />
                        ))}
                        <div className="tm-track-line" />
                        {pkg.releases.map((release, index) => {
                          const date = dateValue(release.date);
                          if (date === null) return null;
                          const isCurrent = pkg.current === release.version;
                          const isSelected =
                            selection?.name === pkg.name &&
                            selection.version === release.version;
                          const isResolved =
                            resolution.data?.status === "resolved" &&
                            resolvedVersions.get(
                              dependencyKey(pkg.name, analysis?.ecosystem),
                            ) === release.version;
                          const hasResearch = researched.has(
                            JSON.stringify([pkg.name, release.version]),
                          );
                          const inExperiment = options.some((option) =>
                            Object.entries(option.combination).some(
                              ([name, version]) =>
                                dependencyKey(name, analysis?.ecosystem) ===
                                  dependencyKey(
                                    pkg.name,
                                    analysis?.ecosystem,
                                  ) && version === release.version,
                            ),
                          );
                          const inDecision =
                            !!selectedDecision &&
                            Object.entries(selectedDecision.combination).some(
                              ([name, version]) =>
                                dependencyKey(name, analysis?.ecosystem) ===
                                  dependencyKey(
                                    pkg.name,
                                    analysis?.ecosystem,
                                  ) && version === release.version,
                            );
                          const evidenceStatus = inDecision
                            ? selectedDecision.outcome === "passed"
                              ? "Selected combination: tests passed"
                              : selectedDecision.outcome === "repair"
                                ? "Selected combination: passed after repair"
                                : selectedDecision.outcome === "failed"
                                  ? "Selected combination: tests failed"
                                  : "Selected combination: inconclusive"
                            : inExperiment
                              ? "Appears in an experiment; outcomes depend on the full combination"
                              : "Not tested in this experiment";
                          const showTip = (element: HTMLElement) => {
                            const rect = element.getBoundingClientRect();
                            setTip({
                              x: Math.max(
                                8,
                                Math.min(
                                  window.innerWidth - 260,
                                  rect.left - 30,
                                ),
                              ),
                              y:
                                rect.bottom + 155 < window.innerHeight
                                  ? rect.bottom + 10
                                  : Math.max(8, rect.top - 140),
                              name: pkg.name,
                              version: release.version,
                              date,
                              status: evidenceStatus,
                              researched: hasResearch,
                            });
                          };
                          return (
                            <button
                              type="button"
                              onMouseEnter={(event) =>
                                showTip(event.currentTarget)
                              }
                              onMouseLeave={() => setTip(null)}
                              onFocus={(event) => showTip(event.currentTarget)}
                              onBlur={() => setTip(null)}
                              aria-describedby={
                                tip?.name === pkg.name &&
                                tip.version === release.version
                                  ? "release-tooltip"
                                  : undefined
                              }
                              className={`tm-release ${isCurrent ? "is-current" : ""} ${isSelected ? "is-selected" : ""} ${isResolved ? "is-resolved" : ""} ${inExperiment ? "in-experiment" : ""} ${inDecision ? `in-decision decision-${selectedDecision?.outcome}` : ""} ${hasResearch ? "has-research" : ""}`}
                              style={
                                {
                                  left: position(date),
                                  "--d": Math.min(index, 24),
                                } as CSSProperties
                              }
                              key={`${release.version}-${index}`}
                              aria-label={`${pkg.name} version ${release.version}, released ${new Date(date).toLocaleDateString()}${isCurrent ? ", current" : ""}${isResolved ? ", resolver selected" : ""}${hasResearch ? ", research available" : ""}${`, ${evidenceStatus}`}`}
                              aria-pressed={isSelected}
                              onClick={() => choose(pkg.name, release.version)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <Pager
                page={activeRowPage}
                size={ROWS_PER_PAGE}
                total={filteredPackages.length}
                onChange={setRowPage}
              />
              {!visible.length && (
                <div className="tm-empty">
                  {dependencyFilter
                    ? "No dependencies match your search."
                    : "No dependencies were found in the supported project files."}
                </div>
              )}
              <p className="tm-scroll-hint">
                Scroll horizontally to explore the release history. Dates show
                availability, not compatibility. Related rows come from
                lockfiles, resolver results or registry declarations. Declared
                relations can be optional and are not confirmed installed. Lines
                connect resolver-selected releases visible on the same page with
                declared requirements; they do not establish a passing test.
              </p>
            </div>
            <aside className="tm-detail" aria-label="Selected release details">
              {selection && selectedPackage ? (
                <>
                  <div className="tm-detail-head">
                    <span>SELECTED RELEASE</span>
                    <button
                      aria-label="Clear selected release"
                      onClick={() => setSelection(null)}
                    >
                      ×
                    </button>
                  </div>
                  <h2>{selection.name}</h2>
                  <div className="tm-version">{selection.version}</div>
                  <div
                    className="tm-tabs"
                    role="tablist"
                    aria-label="Release inspector"
                    style={{ "--tab": tabs.indexOf(tab) } as CSSProperties}
                  >
                    <span className="tm-tab-indicator" aria-hidden="true" />
                    {tabs.map((name) => (
                      <button
                        key={name}
                        type="button"
                        role="tab"
                        id={`tm-tab-${name}`}
                        aria-selected={tab === name}
                        aria-controls="tm-tab-panel"
                        onClick={() => setTab(name)}
                      >
                        {name === "overview" ? (
                          <Info size={14} />
                        ) : name === "resolve" ? (
                          <Layers size={14} />
                        ) : (
                          <FlaskConical size={14} />
                        )}
                        {name === "overview"
                          ? "Overview"
                          : name === "resolve"
                            ? "Resolve"
                            : "Test"}
                        {name === "resolve" && resolution.isFetching && (
                          <i className="live-dot" />
                        )}
                        {name === "resolve" &&
                          !resolution.isFetching &&
                          resolution.data && (
                            <i
                              className={`tm-tab-dot is-${resolution.data.status}`}
                            />
                          )}
                        {name === "test" && queued.length > 0 && (
                          <span className="tm-count">{queued.length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div
                    className="tm-tab-panel"
                    id="tm-tab-panel"
                    role="tabpanel"
                    aria-labelledby={`tm-tab-${tab}`}
                    key={tab}
                  >
                    {tab === "overview" && (
                      <>
                        <div className="tm-info">
                          <span>Current version</span>
                          <strong>
                            {selectedPackage.current || "Unknown"}
                          </strong>
                        </div>
                        <div className="tm-info">
                          <span>Declared requirement</span>
                          <code>
                            {selectedPackage.requirement || "Not available"}
                          </code>
                        </div>
                        {selectedPackage.source && (
                          <p className="tm-limit">
                            Requirement source:{" "}
                            <code>{selectedPackage.source}</code>
                            {selectedPackage.marker && (
                              <>
                                {" "}
                                · Marker: <code>{selectedPackage.marker}</code>
                              </>
                            )}
                          </p>
                        )}
                        <section
                          className="tm-release-research"
                          aria-label="Release research"
                        >
                          <div className="tm-section-label">
                            RELEASE RESEARCH <span>Advisory</span>
                          </div>
                          {research.isError && (
                            <p className="tm-limit">
                              Research could not be loaded.
                            </p>
                          )}
                          {research.data
                            ?.filter(
                              (entry) =>
                                entry.package === selection.name &&
                                entry.version === selection.version,
                            )
                            .slice(0, 3)
                            .map((entry, index) => (
                              <details key={`${entry.searched_at}-${index}`}>
                                <summary>
                                  Sources for {selection.version} ·{" "}
                                  {new Date(
                                    entry.searched_at,
                                  ).toLocaleDateString()}
                                </summary>
                                {entry.summary?.findings.map((finding, i) => (
                                  <p key={i}>
                                    <strong>{finding.category}:</strong>{" "}
                                    {finding.summary}{" "}
                                    {finding.source_urls.map((url, j) => (
                                      <a
                                        key={url}
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        [Source {j + 1}]{" "}
                                      </a>
                                    ))}
                                  </p>
                                ))}
                                {entry.summary?.limitations.map((text, i) => (
                                  <p className="tm-limit" key={i}>
                                    {text}
                                  </p>
                                ))}
                                {entry.sources.map((source) => (
                                  <p key={source.url}>
                                    <a
                                      href={source.url}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {source.title}
                                    </a>
                                    {source.published_date &&
                                    dateValue(source.published_date) !== null
                                      ? ` · ${new Date(source.published_date).toLocaleDateString()}`
                                      : " · publication date unknown"}
                                  </p>
                                ))}
                                <p className="tm-limit">
                                  Search findings and model interpretations do
                                  not indicate test success.
                                </p>
                              </details>
                            ))}
                          {research.data &&
                            !research.data.some(
                              (entry) =>
                                entry.package === selection.name &&
                                entry.version === selection.version,
                            ) && (
                              <p className="tm-limit">
                                No release-specific research yet. Search this
                                dependency and version in What’s new.
                              </p>
                            )}
                        </section>
                        {undated.length > 0 && (
                          <details className="tm-undated">
                            <summary>
                              {undated.length} releases without dates
                            </summary>
                            <div>
                              {undated.map((release) => (
                                <button
                                  type="button"
                                  key={release.version}
                                  onClick={() =>
                                    choose(
                                      selectedPackage.name,
                                      release.version,
                                    )
                                  }
                                >
                                  {release.version}
                                </button>
                              ))}
                            </div>
                          </details>
                        )}
                      </>
                    )}
                    {tab === "resolve" && (
                      <div className="tm-resolution">
                        <div className="tm-section-label">
                          RESOLUTION{" "}
                          <span>
                            {resolution.isFetching
                              ? "Checking"
                              : resolution.data
                                ? resolution.data.status === "resolved"
                                  ? "Resolved"
                                  : resolution.data.status === "conflict"
                                    ? "Conflict"
                                    : resolution.data.status === "unsupported"
                                      ? "Unsupported"
                                      : "Resolution error"
                                : "Not tested"}
                          </span>
                        </div>
                        {resolution.isFetching ? (
                          <ActivityVisual
                            mode="resolution"
                            activity={resolutionActivity.data}
                          />
                        ) : resolution.error ? (
                          <p role="alert">{resolution.error.message}</p>
                        ) : resolution.data ? (
                          <>
                            {resolution.data.message.length > 280 ||
                            resolution.data.message.includes("\n") ? (
                              <LogView
                                title="Resolver output"
                                text={resolution.data.message}
                              />
                            ) : (
                              <p>{resolution.data.message}</p>
                            )}
                            {resolution.data.explanation_status ===
                              "unavailable" && (
                              <p className="tm-limit">
                                Model conflict explanation unavailable. The
                                native resolver output remains available above.
                              </p>
                            )}
                            {resolution.data.explanation && (
                              <details>
                                <summary>
                                  Nemotron explanation <ChevronDown size={14} />
                                </summary>
                                <p>{resolution.data.explanation.summary}</p>
                                {resolution.data.explanation.suggestions.map(
                                  (item, i) => (
                                    <p key={i}>{item}</p>
                                  ),
                                )}
                                {resolution.data.explanation.limitations.map(
                                  (item, i) => (
                                    <p className="tm-limit" key={i}>
                                      {item}
                                    </p>
                                  ),
                                )}
                                <p className="tm-limit">
                                  Model suggestions are advisory and have not
                                  been tested.
                                </p>
                              </details>
                            )}
                            {Object.keys(resolution.data.requirements).length >
                              0 && (
                              <details>
                                <summary>
                                  Declared requirements{" "}
                                  <ChevronDown size={14} />
                                </summary>
                                <dl>
                                  {Object.entries(
                                    resolution.data.requirements,
                                  ).map(([name, requirement]) => (
                                    <div key={name}>
                                      <dt>{name}</dt>
                                      <dd>{requirement}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </details>
                            )}
                            {Object.keys(resolution.data.selected || {})
                              .length > 0 && (
                              <details>
                                <summary>
                                  Resolved dependency set{" "}
                                  <ChevronDown size={14} />
                                </summary>
                                <dl>
                                  {Object.entries(resolution.data.selected).map(
                                    ([name, version]) => (
                                      <div key={name}>
                                        <dt>{name}</dt>
                                        <dd>
                                          {version}
                                          {resolution.data?.requirements?.[
                                            name
                                          ] && (
                                            <small>
                                              {
                                                resolution.data.requirements[
                                                  name
                                                ]
                                              }
                                            </small>
                                          )}
                                        </dd>
                                      </div>
                                    ),
                                  )}
                                </dl>
                              </details>
                            )}
                            {!!resolution.data.edges?.length && (
                              <details>
                                <summary>
                                  Declared connections (
                                  {resolution.data.edges.length}){" "}
                                  <ChevronDown size={14} />
                                </summary>
                                <dl>
                                  {resolution.data.edges.map((edge, index) => (
                                    <div
                                      key={`${edge.source}-${edge.target}-${index}`}
                                    >
                                      <dt>
                                        {edge.source} → {edge.target}
                                      </dt>
                                      <dd>
                                        {edge.requirement || "Any version"}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                                <p className="tm-limit">
                                  Declarations can be optional or conditional. A
                                  line does not mean the combination passed
                                  tests.
                                </p>
                              </details>
                            )}
                          </>
                        ) : (
                          <p>Resolution has not started.</p>
                        )}
                        <p className="tm-limit">
                          A resolved set has not necessarily passed tests.
                        </p>
                      </div>
                    )}
                    {tab === "test" && (
                      <div className="tm-experiment">
                        <div className="tm-section-label">
                          SANDBOX EXPERIMENT <span>OPTIONAL</span>
                        </div>
                        <p>
                          Add releases from up to five dependencies. Every
                          selected combination runs the same tests, with up to
                          three Sandbox branches at once.
                        </p>
                        <button
                          type="button"
                          className="tm-add-version"
                          onClick={() => toggleVersion(selection.version)}
                          disabled={
                            !queued.some(
                              (item) =>
                                item.name === selection.name &&
                                item.version === selection.version,
                            ) &&
                            (queued.filter(
                              (item) => item.name === selection.name,
                            ).length >= 5 ||
                              (!queued.some(
                                (item) => item.name === selection.name,
                              ) &&
                                new Set(queued.map((item) => item.name)).size >=
                                  5))
                          }
                        >
                          {queued.some(
                            (item) =>
                              item.name === selection.name &&
                              item.version === selection.version,
                          )
                            ? "Remove this version"
                            : "Add this version to test"}
                        </button>
                        {queued.length > 0 && (
                          <div className="tm-queued">
                            {queued.map((item) => (
                              <button
                                key={`${item.name}-${item.version}`}
                                type="button"
                                aria-label={`Remove ${item.name} ${item.version} from experiment`}
                                onClick={() =>
                                  setQueued((current) =>
                                    current.filter(
                                      (entry) =>
                                        entry.name !== item.name ||
                                        entry.version !== item.version,
                                    ),
                                  )
                                }
                              >
                                {item.name} {item.version} <span>×</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {!!queued.length && (
                          <p className="tm-limit" role="status">
                            {combinationCount} combinations selected; maximum
                            12.{" "}
                            {combinationCount > 12 &&
                              "Remove releases to continue."}
                          </p>
                        )}
                        {!!queued.length && (
                          <label>
                            Upgrade goal (optional)
                            <select
                              value={
                                queued.some(
                                  (item) => JSON.stringify(item) === goalChoice,
                                )
                                  ? goalChoice
                                  : ""
                              }
                              onChange={(event) =>
                                setGoalChoice(event.target.value)
                              }
                            >
                              <option value="">
                                Compare every selected combination
                              </option>
                              {queued.map((item) => (
                                <option
                                  key={`${item.name}-${item.version}`}
                                  value={JSON.stringify(item)}
                                >
                                  Require {item.name} {item.version}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label>
                          Test command
                          <input
                            value={testCommand}
                            onChange={(event) =>
                              setTestCommand(event.target.value)
                            }
                            placeholder="e.g. python -m pytest"
                          />
                        </label>
                        {!["bun", "go", "cargo"].includes(analysis.manager) ? (
                          <label className="tm-dependency-repair">
                            <input
                              type="checkbox"
                              checked={allowDependencyRepair}
                              onChange={(event) =>
                                setAllowDependencyRepair(event.target.checked)
                              }
                            />{" "}
                            If a source repair fails, let Nemotron propose
                            dependency changes and reinstall them in a fresh
                            Sandbox. When Tavily is configured, dependency
                            names, the selected version, and an extracted error
                            keyword may be sent for public research.
                          </label>
                        ) : (
                          <p>
                            Dependency-file repair is not available for{" "}
                            {analysis.manager}.{" "}
                            {analysis.manager === "cargo" &&
                              "Rust source repair is also unavailable because tests may be embedded in source files."}
                          </p>
                        )}
                        <button
                          type="button"
                          className="primary tm-run"
                          disabled={
                            !queued.length ||
                            combinationCount > 12 ||
                            !testCommand.trim() ||
                            submitting ||
                            !!(
                              run.data &&
                              [
                                "queued",
                                "running",
                                "preparing",
                                "testing",
                              ].includes(run.data.status)
                            )
                          }
                          onClick={startRun}
                        >
                          <FlaskConical size={15} />{" "}
                          {submitting ? "Starting…" : "Run Sandbox tests"}
                        </button>
                        <p className="tm-limit">
                          Runs code and may consume Nebius credits. Review the
                          command before starting.
                        </p>
                        {runError && (
                          <p role="alert" className="tm-run-error">
                            {runError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="tm-no-selection">
                  <div className="tm-no-selection-icon">
                    <CalendarDays size={19} />
                  </div>
                  <h3>Select a release</h3>
                  <p>
                    Choose a point on the timeline to see its requirement and
                    resolve a candidate dependency set.
                  </p>
                </div>
              )}
            </aside>
          </div>
          {runId && (
            <section className="tm-results" ref={resultsRef}>
              <div className="tm-results-head">
                <div>
                  <span className="tm-step">03</span>
                  <h2>Sandbox experiment</h2>
                  <p>
                    Results apply only to these versions and the selected test
                    command.
                  </p>
                </div>
                {run.data &&
                  [
                    "queued",
                    "running",
                    "preparing",
                    "testing",
                    "cancelling",
                  ].includes(run.data.status) && (
                    <button onClick={cancelRun}>Cancel run</button>
                  )}
              </div>
              {run.isPending ? (
                <Skeleton rows={4} label="Loading experiment" />
              ) : run.error ? (
                <p role="alert" className="error">
                  {run.error.message}
                </p>
              ) : (
                run.data && (
                  <>
                    <div
                      className={`tm-run-status status-${run.data.status}`}
                      role="status"
                    >
                      <span
                        className={`tm-result-dot ${["queued", "running", "preparing", "testing", "cancelling"].includes(run.data.status) ? "live" : run.data.status === "completed" ? "done" : resultClass(run.data.status)}`}
                      />
                      <strong>{resultLabel(run.data.status)}</strong>
                      <span className="tm-run-tally">
                        {run.data.results.length} combination
                        {run.data.results.length === 1 ? "" : "s"}
                        {run.data.goal &&
                          ` · goal ${run.data.goal.package} ${run.data.goal.version}`}
                      </span>
                      <code className="tm-run-command">
                        <Terminal size={13} /> {run.data.test_command}
                      </code>
                    </div>
                    {run.data.error && (
                      <p className="error" role="alert">
                        {run.data.error}
                      </p>
                    )}
                    {[
                      "queued",
                      "running",
                      "preparing",
                      "testing",
                      "cancelling",
                    ].includes(run.data.status) && (
                      <ActivityVisual
                        mode="run"
                        activity={
                          run.data.status === "cancelling"
                            ? { stage: "cancelling" }
                            : run.data.activity
                        }
                      />
                    )}
                    {run.data.model && (
                      <p className="tm-limit">
                        Configured agent model: <code>{run.data.model}</code>.
                        The model is called only to explain a conflict or
                        investigate a qualifying test failure.
                      </p>
                    )}
                    {!!run.data.activity_history?.length && (
                      <details className="tm-agent-history">
                        <summary>
                          <HistoryIcon size={15} /> Recorded activity
                          <span className="tm-count">
                            {run.data.activity_history.length}
                          </span>
                          <ChevronDown size={14} className="tm-chevron" />
                        </summary>
                        <ol className="tm-rail">
                          {run.data.activity_history.map((event, index) => (
                            <li key={`${event.at}-${index}`}>
                              <time>
                                {new Date(event.at * 1000).toLocaleTimeString()}
                              </time>
                              <span>{event.stage.replaceAll("_", " ")}</span>
                              {event.version && <code>{event.version}</code>}
                            </li>
                          ))}
                        </ol>
                        <p className="tm-limit">
                          Stages are recorded events; they do not expose model
                          reasoning or command logs.
                        </p>
                      </details>
                    )}
                    {!!run.data.agent_decisions?.length && (
                      <details className="tm-agent-history">
                        <summary>
                          <Bot size={15} /> Agent plan and decisions
                          <span className="tm-count">
                            {run.data.agent_decisions.length}
                          </span>
                          <ChevronDown size={14} className="tm-chevron" />
                        </summary>
                        <p className="tm-limit">
                          Model-authored plans are provisional. Tool actions and
                          exit codes are recorded observations, not proof of a
                          verified repair.
                        </p>
                        <ol className="tm-rail tm-decisions">
                          {run.data.agent_decisions.map((event, index) => (
                            <li
                              key={`${event.at}-${index}`}
                              className={`kind-${event.kind} ${event.kind === "tool_result" && event.exit_code ? "is-nonzero" : ""}`}
                            >
                              <div className="tm-rail-head">
                                <time>
                                  {new Date(
                                    event.at * 1000,
                                  ).toLocaleTimeString()}
                                </time>
                                <span className="tm-kind">
                                  {event.kind === "tool" ||
                                  event.kind === "tool_result" ? (
                                    <Wrench size={12} />
                                  ) : event.kind === "model" ? (
                                    <Sparkles size={12} />
                                  ) : (
                                    <Bot size={12} />
                                  )}
                                  {event.kind.replaceAll("_", " ")}
                                  {event.turn ? ` ${event.turn}` : ""}
                                </span>
                                <code>{event.version}</code>
                              </div>
                              {event.goal && (
                                <p>
                                  <strong>Goal:</strong> {event.goal}
                                </p>
                              )}
                              {!!event.steps?.length && (
                                <ul>
                                  {event.steps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                  ))}
                                </ul>
                              )}
                              {event.limitations?.map((text, i) => (
                                <p key={i}>{text}</p>
                              ))}
                              {event.text && <p>{event.text}</p>}
                              {event.kind === "model" && !event.text && (
                                <p>
                                  The model provided no written decision for
                                  this turn; it requested{" "}
                                  {event.tool_count || 0} tool action(s).
                                </p>
                              )}
                              {event.kind === "tool" && (
                                <p>
                                  Requested {event.tool}:
                                  <code className="tm-tool-input">
                                    {event.input}
                                  </code>
                                </p>
                              )}
                              {event.kind === "tool_result" && (
                                <p>
                                  {event.tool}{" "}
                                  {event.exit_code == null
                                    ? "finished without an exit code"
                                    : `exit ${event.exit_code}`}
                                  {event.error ? ` · ${event.error}` : ""}
                                </p>
                              )}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                    {run.data.agent_decisions?.length === 0 && (
                      <p className="tm-limit">
                        No model decisions recorded for this experiment.
                      </p>
                    )}
                    {!run.data.agent_decisions && (
                      <p className="tm-limit">
                        Detailed agent decisions were not recorded for this
                        older experiment.
                      </p>
                    )}
                    {run.data.baseline && (
                      <ResultCard title="Baseline" result={run.data.baseline} />
                    )}
                    {options.length > 0 && (
                      <div className="tm-comparison">
                        <h3>Compare experiment combinations</h3>
                        <p className="tm-limit">
                          Select a row to highlight its exact versions and
                          review evidence on the timeline. A result applies to
                          the full combination and this test command.
                        </p>
                        {run.data.status === "completed" &&
                          recommendation.recommended.length > 0 && (
                            <div className="tm-recommendation" role="status">
                              <strong>
                                Suggested: fewest selected dependency changes
                              </strong>
                              <p>
                                {recommendation.changes} change(s) from known
                                current versions or exact pins
                                {run.data.goal
                                  ? `, meeting the ${run.data.goal.package} ${run.data.goal.version} goal`
                                  : ""}
                                . Only passing combinations from this experiment
                                are ranked; ties are shown.{" "}
                                {recommendation.recommended.some(
                                  (option) => option.outcome === "repair",
                                ) &&
                                  "A suggested option requires the verified patch."}
                                {!run.data.goal &&
                                  " No upgrade goal was set, so current versions can be suggested."}
                              </p>
                              <div className="tm-decision-actions">
                                {recommendation.recommended.map((option) => (
                                  <button
                                    type="button"
                                    key={option.key}
                                    onClick={() => inspectDecision(option)}
                                  >
                                    Review{" "}
                                    {Object.entries(option.combination)
                                      .map(
                                        ([name, version]) =>
                                          `${name} ${version}`,
                                      )
                                      .join(" · ")}
                                    {option.outcome === "repair"
                                      ? " · repair required"
                                      : ""}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        {run.data.status === "completed" &&
                          recommendation.eligible.length > 0 &&
                          recommendation.changes === null && (
                            <p className="tm-limit">
                              Passing options are available, but current
                              versions are incomplete, so the fewest-changes
                              recommendation is unavailable.
                            </p>
                          )}
                        {run.data.status === "completed" &&
                          recommendation.eligible.length === 0 && (
                            <p className="tm-limit">
                              No tested combination
                              {run.data.goal
                                ? " meeting the selected goal"
                                : ""}{" "}
                              passed directly or after a verified repair.
                            </p>
                          )}
                        {run.data.status !== "completed" && (
                          <p className="tm-limit">
                            Recommendations appear after the experiment
                            completes.
                          </p>
                        )}
                        <div className="tm-comparison-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th scope="col">Dependency versions</th>
                                <th scope="col">Resolution</th>
                                <th scope="col">Tests and repair</th>
                                <th scope="col">Timeline</th>
                              </tr>
                            </thead>
                            <tbody>
                              {options.map((option) => {
                                const result =
                                  run.data!.results[option.resultIndex];
                                const label = Object.entries(option.combination)
                                  .map(
                                    ([name, version]) => `${name} ${version}`,
                                  )
                                  .join(" · ");
                                return (
                                  <tr
                                    key={option.key}
                                    className={
                                      decisionKey === option.key
                                        ? "is-active"
                                        : ""
                                    }
                                  >
                                    <td>
                                      <span className="tm-combo">
                                        {Object.entries(option.combination).map(
                                          ([name, version]) => (
                                            <code key={name}>
                                              {name} <b>{version}</b>
                                            </code>
                                          ),
                                        )}
                                      </span>
                                    </td>
                                    <td>
                                      <span
                                        className={`tm-chip ${result.resolution_status === "succeeded" ? "passed" : result.resolution_status ? "failed" : ""}`}
                                      >
                                        {result.resolution_status ===
                                        "succeeded"
                                          ? "Succeeded"
                                          : result.resolution_status
                                            ? "Failed or inconclusive"
                                            : "Not recorded"}
                                      </span>
                                    </td>
                                    <td>
                                      <span
                                        className={`tm-chip ${option.outcome}`}
                                      >
                                        {option.outcome === "passed"
                                          ? "Tests passed"
                                          : option.outcome === "repair"
                                            ? option.dependencyRepairIndex !==
                                              undefined
                                              ? "Dependency patch verified"
                                              : "Tests failed; source patch verified"
                                            : option.outcome === "failed"
                                              ? "Tests failed"
                                              : "Not tested or inconclusive"}
                                        {result.repair_pending &&
                                          " · investigating"}
                                      </span>
                                    </td>
                                    <td>
                                      <button
                                        type="button"
                                        className="tm-review-button"
                                        aria-pressed={
                                          decisionKey === option.key
                                        }
                                        aria-label={`Review ${label} on timeline`}
                                        onClick={() => inspectDecision(option)}
                                      >
                                        Review
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {run.data.results?.map((result, index) => (
                      <ResultCard
                        key={`${result.version}-${index}`}
                        title={
                          result.combination
                            ? Object.entries(result.combination)
                                .map(([name, version]) => `${name} ${version}`)
                                .join(" · ")
                            : result.version || "Candidate"
                        }
                        result={result}
                      />
                    ))}
                    {run.data.results?.length === 0 && (
                      <p className="tm-limit">
                        Waiting for results. No version has been marked as
                        passed.
                      </p>
                    )}
                  </>
                )
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

function ResultCard({ title, result }: { title: string; result: Result }) {
  const status =
    result.status ||
    (result.timed_out || result.exit_code == null
      ? "inconclusive"
      : result.exit_code === 0
        ? "passed"
        : "failed");
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const installationOutput = [
    result.installation?.stdout,
    result.installation?.stderr,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <details className={`tm-result is-${resultClass(status)}`}>
      <summary>
        <span>
          <i className={`tm-result-dot ${resultClass(status)}`} />
          <strong>{title}</strong>
        </span>
        <span>
          <span className={`tm-chip ${status}`}>{resultLabel(status)}</span>
          <ChevronDown size={14} className="tm-chevron" />
        </span>
      </summary>
      <div>
        <dl className="tm-result-facts">
          <div>
            <dt>Exit code</dt>
            <dd>
              <code>{result.exit_code ?? "not available"}</code>
            </dd>
          </div>
          {result.operation_id && (
            <div>
              <dt>Operation</dt>
              <dd>
                <code>{result.operation_id}</code>
              </dd>
            </div>
          )}
          {result.image_id && (
            <div>
              <dt>Image</dt>
              <dd>
                <code>{result.image_id}</code>
              </dd>
            </div>
          )}
        </dl>
        {result.error && (
          <p className="tm-result-error" role="alert">
            {result.error}
          </p>
        )}
        {result.timed_out && (
          <p>The command timed out; the result is inconclusive.</p>
        )}
        {result.installation && (
          <details className="tm-sub">
            <summary>
              Installation output{" "}
              <ChevronDown size={14} className="tm-chevron" />
            </summary>
            <LogView
              title="Installation"
              text={installationOutput}
              empty="No installation output available."
            />
          </details>
        )}
        <LogView
          title="Test output"
          text={output}
          empty="No test output available."
        />
        {result.explanation && (
          <section className="tm-repair tm-investigation">
            <h3>
              <Sparkles size={14} /> Nemotron investigation
            </h3>
            <p>{result.explanation}</p>
            <p className="tm-limit">
              Model explanation is advisory; inspect the recorded test output
              and code.
            </p>
          </section>
        )}
        {result.repair && (
          <section className="tm-repair">
            <h3>
              <Wrench size={14} /> Proposed repair
            </h3>
            <p>
              <strong>
                {
                  (
                    {
                      verified: "Patch passed selected tests",
                      failed: "Patch verification failed",
                      rejected: "Patch rejected",
                      unavailable: "Repair unavailable",
                    } as const
                  )[result.repair.status]
                }
              </strong>
            </p>
            {result.repair.explanation && <p>{result.repair.explanation}</p>}
            {result.repair.error && <p role="alert">{result.repair.error}</p>}
            {result.repair.patch && (
              <details>
                <summary>View proposed patch</summary>
                <a
                  href={`data:text/x-diff;charset=utf-8,${encodeURIComponent(result.repair.patch)}`}
                  download="oriclus-source.patch"
                >
                  Download source patch
                </a>
                <LogView diff title="Source patch" text={result.repair.patch} />
              </details>
            )}
            {result.repair.verification && (
              <ResultCard
                title="Independent verification"
                result={result.repair.verification}
              />
            )}
            <p className="tm-limit">
              The patch is a proposal and has not been applied to your project.
            </p>
          </section>
        )}
        {(result.dependency_repairs?.length
          ? result.dependency_repairs
          : result.dependency_repair
            ? [result.dependency_repair]
            : []
        ).map((proposal, index) => (
          <section className="tm-repair" key={index}>
            <h3>
              <Wrench size={14} /> Dependency change proposal {index + 1}
            </h3>
            <p>
              <strong>
                {proposal.status === "verified"
                  ? "Changed dependencies passed selected tests"
                  : `Dependency repair ${proposal.status}`}
              </strong>
            </p>
            {proposal.explanation && <p>{proposal.explanation}</p>}
            {proposal.changes?.length > 0 && (
              <p className="tm-combo">
                Proposed:
                {proposal.changes.map((change) => (
                  <code key={change.package}>
                    {change.package} <b>{change.version}</b>
                  </code>
                ))}
              </p>
            )}
            {!!proposal.research?.length && (
              <details>
                <summary>Research sources (advisory)</summary>
                <ul>
                  {proposal.research.map((source, index) => (
                    <li key={`${source.url}-${index}`}>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title || source.url}
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="tm-limit">
                  Sources help the agent investigate; they are not proof of
                  compatibility.
                </p>
              </details>
            )}
            {proposal.error && <p role="alert">{proposal.error}</p>}
            {proposal.patch && (
              <details>
                <summary>View dependency and lockfile changes</summary>
                <a
                  href={`data:text/x-diff;charset=utf-8,${encodeURIComponent(proposal.patch)}`}
                  download="oriclus-dependency.patch"
                >
                  Download dependency patch
                </a>
                <LogView diff title="Dependency patch" text={proposal.patch} />
              </details>
            )}
            {proposal.independent_installation && (
              <details>
                <summary>
                  Fresh branch installation · exit{" "}
                  {proposal.independent_installation.exit_code ?? "unknown"}
                </summary>
                <LogView
                  title="Fresh branch installation"
                  text={[
                    proposal.independent_installation.stdout,
                    proposal.independent_installation.stderr,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                />
              </details>
            )}
            {proposal.verification && (
              <ResultCard
                title="Independent dependency verification"
                result={proposal.verification}
              />
            )}
            <p className="tm-limit">
              The proposal changes a separate Sandbox branch; review the patch
              before using it. It is not applied to your project.
            </p>
          </section>
        ))}
      </div>
    </details>
  );
}
