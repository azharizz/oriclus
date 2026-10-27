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
  explanation?: {
    summary: string;
    suggestions: string[];
    limitations: string[];
  } | null;
};
type Result = {
  version?: string;
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
  test_command: string;
  baseline?: Result | null;
  results: Result[];
  error?: string | null;
  activity?: Activity | null;
};
type RecentExperiment = {
  id: string;
  analysis_id: string;
  package: string;
  versions: string[];
  status: string;
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

export default function Timeline() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<"github" | "local">("github");
  const [location, setLocation] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [queued, setQueued] = useState<string[]>([]);
  const [showTransitive, setShowTransitive] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [testCommand, setTestCommand] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runError, setRunError] = useState("");
  const [recentLimit, setRecentLimit] = useState(10);

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
  const visible = packages.filter((pkg) => pkg.direct || showTransitive);
  const selectedPackage = packages.find((pkg) => pkg.name === selection?.name);
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
    setRunId(null);
    setRunError("");
    try {
      const result = await api<Analysis>("/timeline/analyze", {
        source,
        location: location.trim(),
      });
      setAnalysis(result);
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
    if (selection?.name !== name) {
      setQueued([]);
      if (run.data?.package !== name) setRunId(null);
    }
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
    setQueued((current) =>
      current.includes(version)
        ? current.filter((item) => item !== version)
        : current.length < 5
          ? [...current, version]
          : current,
    );
  }

  async function startRun() {
    if (!analysis || !selection || !queued.length || !testCommand.trim())
      return;
    setSubmitting(true);
    setRunError("");
    try {
      const created = await api<Experiment>("/timeline/runs", {
        analysis_id: analysis.id,
        package: selection.name,
        versions: queued,
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
                {analysis.ecosystem} <span>·</span> {analysis.manager}{" "}
                <span>·</span> {packages.filter((item) => item.direct).length}{" "}
                direct · {packages.filter((item) => !item.direct).length}{" "}
                related
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
                          key={year}
                          style={{ left: position(Date.UTC(year, 0, 1)) + 10 }}
                        >
                          {year}
                        </span>
                      ))}
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
                          const tested =
                            run.data?.package === pkg.name
                              ? run.data?.results?.find(
                                  (result) =>
                                    result.version === release.version,
                                )
                              : undefined;
                          return (
                            <button
                              type="button"
                              className={`tm-release ${isCurrent ? "is-current" : ""} ${isSelected ? "is-selected" : ""} ${isResolved ? "is-resolved" : ""} ${tested?.status === "passed" ? "is-tested-pass" : tested?.status === "failed" ? "is-tested-fail" : ""}`}
                              style={{ left: position(date) }}
                              key={`${release.version}-${index}`}
                              title={`${pkg.name} ${release.version} · ${new Date(date).toLocaleDateString()}`}
                              aria-label={`${pkg.name} version ${release.version}, released ${new Date(date).toLocaleDateString()}${isCurrent ? ", current" : ""}${isResolved ? ", resolver selected" : ""}${tested ? `, ${resultLabel(tested.status || "inconclusive")}` : ", not tested"}`}
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
                      Choose up to five releases of {selection.name} and run the
                      same test command.
                    </p>
                    <button
                      type="button"
                      className="tm-add-version"
                      onClick={() => toggleVersion(selection.version)}
                      disabled={
                        !queued.includes(selection.version) &&
                        queued.length >= 5
                      }
                    >
                      {queued.includes(selection.version)
                        ? "Remove this version"
                        : "Add this version to test"}
                    </button>
                    {queued.length > 0 && (
                      <div className="tm-queued">
                        {queued.map((version) => (
                          <button
                            key={version}
                            type="button"
                            aria-label={`Remove version ${version} from experiment`}
                            onClick={() => toggleVersion(version)}
                          >
                            {version} <span>×</span>
                          </button>
                        ))}
                      </div>
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
                    {run.data.baseline && (
                      <ResultCard title="Baseline" result={run.data.baseline} />
                    )}
                    {run.data.results?.map((result, index) => (
                      <ResultCard
                        key={`${result.version}-${index}`}
                        title={result.version || "Candidate"}
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
