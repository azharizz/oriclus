import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  FlaskConical,
  GitBranch,
  LoaderCircle,
} from "lucide-react";
import { api } from "./api";
import ActivityVisual, { type Activity } from "./ActivityVisual";
import "./timeline.css";

type Release = { version: string; date: string | null };
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
  onTargetHandled,
}: {
  onAnalysis: (id: string) => void;
  target: { id: string; package: string; version: string } | null;
  onTargetHandled: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<"github" | "local">("github");
  const [location, setLocation] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [queued, setQueued] = useState<Selection[]>([]);
  const [goalChoice, setGoalChoice] = useState("");
  const [showTransitive, setShowTransitive] = useState(true);
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

  useEffect(() => {
    if (!target) return;
    let live = true;
    api<Analysis>(`/timeline/analyses/${encodeURIComponent(target.id)}`)
      .then((data) => {
        if (live) {
          setAnalysis(data);
          onAnalysis(data.id);
          setSelection({ name: target.package, version: target.version });
        }
      })
      .catch((err) => {
        if (live)
          setError(
            err instanceof Error ? err.message : "Could not open project.",
          );
      });
    return () => {
      live = false;
    };
  }, [target, onAnalysis]);
  useEffect(() => {
    if (target && analysis?.id === target.id) onTargetHandled();
  }, [analysis, target, onTargetHandled]);

  useEffect(() => {
    if (analysis && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [analysis]);

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
    const known = new Set(initial.map((item) => item.name.toLowerCase()));
    return [
      ...initial,
      ...(resolution.data?.packages || []).filter(
        (item) => !known.has(item.name.toLowerCase()),
      ),
    ];
  }, [analysis, resolution.data]);
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
  const visible = packages.filter((pkg) => pkg.direct || showTransitive);
  const selectedPackage = packages.find((pkg) => pkg.name === selection?.name);
  const selections = queued.reduce<Record<string, string[]>>((groups, item) => {
    (groups[item.name] ||= []).push(item.version);
    return groups;
  }, {});
  const combinationCount = Object.values(selections).reduce(
    (count, versions) => count * versions.length,
    queued.length ? 1 : 0,
  );
  const passingChoices = (run.data?.results || [])
    .filter(
      (result) =>
        result.combination &&
        (result.status === "passed" || result.repair?.status === "verified") &&
        (!run.data?.goal ||
          result.combination[run.data.goal.package] === run.data.goal.version),
    )
    .map((result) => {
      const entries = Object.entries(result.combination!);
      const currents = entries.map(([name]) => {
        const pkg = packages.find((item) => item.name === name);
        return (
          pkg?.current ||
          pkg?.requirement.match(/^==([A-Za-z0-9][A-Za-z0-9._+!-]*)$/)?.[1]
        );
      });
      return {
        result,
        changes: currents.every(Boolean)
          ? entries.filter(([, version], index) => currents[index] !== version)
              .length
          : null,
      };
    });
  const fewestChanges =
    passingChoices.length &&
    passingChoices.every((item) => item.changes !== null)
      ? Math.min(...passingChoices.map((item) => item.changes!))
      : null;
  const undated =
    selectedPackage?.releases.filter(
      (release) => dateValue(release.date) === null,
    ) || [];

  async function analyze(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    setAnalysis(null);
    setSelection(null);
    setQueued([]);
    setGoalChoice("");
    setRunId(null);
    setRunError("");
    try {
      const result = await api<Analysis>("/timeline/analyze", {
        source,
        location: location.trim(),
      });
      setAnalysis(result);
      onAnalysis(result.id);
      setTestCommand(
        result.ecosystem === "python"
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
      </header>
      <form className="tm-source" onSubmit={analyze}>
        <div className="tm-source-heading">
          <div>
            <span className="tm-step">01</span>
            <strong>Choose a project</strong>
          </div>
          <small>Inspect dependencies before running code</small>
        </div>
        <div className="tm-source-fields">
          <label>
            Source
            <select
              value={source}
              onChange={(event) =>
                setSource(event.target.value as "github" | "local")
              }
            >
              <option value="github">Public GitHub</option>
              <option value="local">Local directory</option>
            </select>
          </label>
          <label className="tm-location">
            {source === "github" ? "Repository URL" : "Absolute directory path"}
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
        <p className="tm-source-note">
          Resolving or testing uploads project files to Nebius Sandboxes. Failed
          test output and relevant source may be sent to Nemotron. Review your
          files and command before continuing.
        </p>
        {loading && (
          <ActivityVisual mode="scan" activity={{ stage: "scanning" }} />
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
      {!!recent.data?.length && (
        <details className="tm-recent">
          <summary>
            Recent Sandbox experiments <ChevronDown size={14} />
          </summary>
          <div className="tm-recent-list">
            {recent.data.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openRecent(item)}
              >
                <strong>{item.package}</strong>
                <span>{item.versions.join(", ")}</span>
                <span>{resultLabel(item.status)}</span>
                <span>Run {item.id.slice(0, 8)}</span>
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
              <span>01</span>
              <strong>Explore</strong>
              <p>Compare release dates and requirements.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Resolve</strong>
              <p>See a candidate set using the project’s package manager.</p>
            </div>
            <div>
              <span>03</span>
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
          <div className="tm-workspace-head">
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
              <label className="tm-check">
                <input
                  type="checkbox"
                  checked={showTransitive}
                  onChange={(event) => setShowTransitive(event.target.checked)}
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
            <span>
              <i className="tm-key release" /> Available release
            </span>
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
                ref={scrollRef}
                role="region"
                aria-label="Dependency release timeline, scroll horizontally to explore"
                tabIndex={0}
                onScroll={() => setTip(null)}
              >
                <div className="tm-grid" style={{ width: timelineWidth + 210 }}>
                  <div className="tm-axis">
                    <div className="tm-axis-label">
                      DEPENDENCY <span>{visible.length}</span>
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
                  {visible.map((pkg) => (
                    <div className="tm-row" key={pkg.name}>
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
                            resolution.data.selected[pkg.name] ===
                              release.version;
                          const hasResearch = researched.has(
                            JSON.stringify([pkg.name, release.version]),
                          );
                          const tested =
                            run.data?.package === pkg.name &&
                            !run.data?.results?.some(
                              (result) =>
                                Object.keys(result.combination || {}).length >
                                1,
                            )
                              ? run.data?.results?.find(
                                  (result) =>
                                    result.version === release.version,
                                )
                              : undefined;
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
                              status: tested
                                ? resultLabel(tested.status || "inconclusive")
                                : isResolved
                                  ? "Resolver selected · not tested"
                                  : "Not tested",
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
                              className={`tm-release ${isCurrent ? "is-current" : ""} ${isSelected ? "is-selected" : ""} ${isResolved ? "is-resolved" : ""} ${tested?.status === "passed" ? "is-tested-pass" : tested?.status === "failed" ? "is-tested-fail" : ""} ${hasResearch ? "has-research" : ""}`}
                              style={{ left: position(date) }}
                              key={`${release.version}-${index}`}
                              aria-label={`${pkg.name} version ${release.version}, released ${new Date(date).toLocaleDateString()}${isCurrent ? ", current" : ""}${isResolved ? ", resolver selected" : ""}${hasResearch ? ", research available" : ""}${tested ? `, ${resultLabel(tested.status || "inconclusive")}` : ", not tested"}`}
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
              {!visible.length && (
                <div className="tm-empty">
                  No dependencies were found in the supported project files.
                </div>
              )}
              <p className="tm-scroll-hint">
                Scroll horizontally to explore the release history. Dates show
                availability, not compatibility. Related rows come from
                lockfiles, resolver results or registry declarations. Declared
                relations can be optional and are not confirmed installed.
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
                  <div className="tm-info">
                    <span>Current version</span>
                    <strong>{selectedPackage.current || "Unknown"}</strong>
                  </div>
                  <div className="tm-info">
                    <span>Declared requirement</span>
                    <code>
                      {selectedPackage.requirement || "Not available"}
                    </code>
                  </div>
                  {selectedPackage.source && (
                    <p className="tm-limit">
                      Requirement source: <code>{selectedPackage.source}</code>
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
                      <p className="tm-limit">Research could not be loaded.</p>
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
                            {new Date(entry.searched_at).toLocaleDateString()}
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
                            Search findings and model interpretations do not
                            indicate test success.
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
                        <p>{resolution.data.message}</p>
                        {resolution.data.explanation_status ===
                          "unavailable" && (
                          <p className="tm-limit">
                            Model conflict explanation unavailable. The native
                            resolver output remains available above.
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
                              Model suggestions are advisory and have not been
                              tested.
                            </p>
                          </details>
                        )}
                        {Object.keys(resolution.data.requirements).length >
                          0 && (
                          <details>
                            <summary>
                              Declared requirements <ChevronDown size={14} />
                            </summary>
                            <dl>
                              {Object.entries(resolution.data.requirements).map(
                                ([name, requirement]) => (
                                  <div key={name}>
                                    <dt>{name}</dt>
                                    <dd>{requirement}</dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          </details>
                        )}
                        {Object.keys(resolution.data.selected || {}).length >
                          0 && (
                          <details>
                            <summary>
                              Resolved dependency set <ChevronDown size={14} />
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
                                          {resolution.data.requirements[name]}
                                        </small>
                                      )}
                                    </dd>
                                  </div>
                                ),
                              )}
                            </dl>
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
                  <div className="tm-experiment">
                    <div className="tm-section-label">
                      SANDBOX EXPERIMENT <span>OPTIONAL</span>
                    </div>
                    <p>
                      Add releases from up to five dependencies. Every selected
                      combination runs the same tests, with up to three Sandbox
                      branches at once.
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
                        (queued.filter((item) => item.name === selection.name)
                          .length >= 5 ||
                          (!queued.some(
                            (item) => item.name === selection.name,
                          ) &&
                            new Set(queued.map((item) => item.name)).size >= 5))
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
                        {combinationCount} combinations selected; maximum 12.{" "}
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
                        onChange={(event) => setTestCommand(event.target.value)}
                        placeholder="e.g. python -m pytest"
                      />
                    </label>
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
                  {undated.length > 0 && (
                    <details className="tm-undated">
                      <summary>{undated.length} releases without dates</summary>
                      <div>
                        {undated.map((release) => (
                          <button
                            type="button"
                            key={release.version}
                            onClick={() =>
                              choose(selectedPackage.name, release.version)
                            }
                          >
                            {release.version}
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
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
            <section className="tm-results">
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
                <p role="status">Loading experiment…</p>
              ) : run.error ? (
                <p role="alert" className="error">
                  {run.error.message}
                </p>
              ) : (
                run.data && (
                  <>
                    <div className="tm-run-status">
                      <span
                        className={`tm-result-dot ${resultClass(run.data.status)}`}
                      />{" "}
                      {resultLabel(run.data.status)}{" "}
                      {run.data.error && `· ${run.data.error}`}
                    </div>
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
                        <summary>Recorded activity</summary>
                        <ol>
                          {run.data.activity_history.map((event, index) => (
                            <li key={`${event.at}-${index}`}>
                              <time>
                                {new Date(event.at * 1000).toLocaleTimeString()}
                              </time>{" "}
                              · {event.stage.replaceAll("_", " ")}
                              {event.version ? ` · ${event.version}` : ""}
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
                          Agent plan and decisions (
                          {run.data.agent_decisions.length})
                        </summary>
                        <p className="tm-limit">
                          Model-authored plans are provisional. Tool actions and
                          exit codes are recorded observations, not proof of a
                          verified repair.
                        </p>
                        <ol>
                          {run.data.agent_decisions.map((event, index) => (
                            <li key={`${event.at}-${index}`}>
                              <time>
                                {new Date(event.at * 1000).toLocaleTimeString()}
                              </time>{" "}
                              · {event.version} ·{" "}
                              {event.kind.replaceAll("_", " ")}
                              {event.turn ? ` ${event.turn}` : ""}
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
                                  Requested {event.tool}:{" "}
                                  <code>{event.input}</code>
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
                    {run.data.results.some(
                      (result) =>
                        result.combination &&
                        Object.keys(result.combination).length > 1,
                    ) && (
                      <div className="tm-comparison">
                        <h3>Combination results</h3>
                        <p className="tm-limit">
                          Each row is one tested set. A passing result applies
                          only to the selected command and environment.
                        </p>
                        {fewestChanges !== null &&
                          run.data.status === "completed" && (
                            <p className="tm-limit">
                              Suggested for fewest changes among selected
                              dependencies, compared with known current versions
                              or exact manifest pins:{" "}
                              {passingChoices
                                .filter(
                                  (item) => item.changes === fewestChanges,
                                )
                                .map(
                                  (item) =>
                                    Object.entries(item.result.combination!)
                                      .map(
                                        ([name, version]) =>
                                          `${name} ${version}`,
                                      )
                                      .join(" · ") +
                                    (item.result.repair?.status ===
                                      "verified" &&
                                    item.result.status !== "passed"
                                      ? " (requires verified patch)"
                                      : ""),
                                )
                                .join("; ")}
                              . This ranks only the selected, passing
                              combinations
                              {run.data.goal
                                ? ` meeting the ${run.data.goal.package} ${run.data.goal.version} goal`
                                : ""}
                              .
                            </p>
                          )}
                        {run.data.status === "completed" &&
                          run.data.goal &&
                          passingChoices.length === 0 && (
                            <p className="tm-limit">
                              No tested combination met the upgrade goal with
                              passing tests or a verified repair.
                            </p>
                          )}
                        {run.data.status === "completed" &&
                          fewestChanges === null &&
                          passingChoices.length > 0 && (
                            <p className="tm-limit">
                              {passingChoices.length} tested combination(s)
                              passed directly or with a verified patch
                              {run.data.goal
                                ? ` for the ${run.data.goal.package} ${run.data.goal.version} goal`
                                : ""}
                              . Current versions are incomplete, so Oriclus
                              cannot rank by number of changes.
                            </p>
                          )}
                        <div className="tm-comparison-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th scope="col">Dependency versions</th>
                                <th scope="col">Resolution</th>
                                <th scope="col">Tests</th>
                                <th scope="col">Repair</th>
                              </tr>
                            </thead>
                            <tbody>
                              {run.data.results.map((result, index) => (
                                <tr key={index}>
                                  <td>
                                    {Object.entries(result.combination || {})
                                      .map(
                                        ([name, version]) =>
                                          `${name} ${version}`,
                                      )
                                      .join(" · ")}
                                  </td>
                                  <td>
                                    {result.resolution_status === "succeeded"
                                      ? "Succeeded"
                                      : result.resolution_status
                                        ? "Failed or inconclusive"
                                        : "Pending"}
                                  </td>
                                  <td>
                                    {resultLabel(
                                      result.status || "inconclusive",
                                    )}
                                  </td>
                                  <td>
                                    {result.repair_pending
                                      ? "Investigating"
                                      : result.repair
                                        ? resultLabel(result.repair.status)
                                        : "Not attempted"}
                                  </td>
                                </tr>
                              ))}
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
    <details className="tm-result">
      <summary>
        <span>
          <i className={`tm-result-dot ${resultClass(status)}`} />{" "}
          <strong>{title}</strong>
        </span>
        <span>
          {resultLabel(status)} <ChevronDown size={14} />
        </span>
      </summary>
      <div>
        <p>Exit code: {result.exit_code ?? "not available"}</p>
        {result.operation_id && (
          <p>
            Operation: <code>{result.operation_id}</code>
          </p>
        )}
        {result.image_id && (
          <p>
            Image: <code>{result.image_id}</code>
          </p>
        )}
        {result.error && <p>{result.error}</p>}
        {result.timed_out && (
          <p>The command timed out; the result is inconclusive.</p>
        )}
        {result.installation && (
          <details>
            <summary>Installation output</summary>
            <pre>
              {installationOutput || "No installation output available."}
            </pre>
          </details>
        )}
        <pre>{output || "No test output available."}</pre>
        {result.explanation && (
          <section className="tm-repair">
            <h3>Nemotron investigation</h3>
            <p>{result.explanation}</p>
            <p className="tm-limit">
              Model explanation is advisory; inspect the recorded test output
              and code.
            </p>
          </section>
        )}
        {result.repair && (
          <section className="tm-repair">
            <h3>Proposed repair</h3>
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
                <pre>{result.repair.patch}</pre>
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
      </div>
    </details>
  );
}
