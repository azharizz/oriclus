import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useMemo, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  Info,
  Newspaper,
  RefreshCw,
  Search,
} from "lucide-react";
import { Skeleton } from "./ui";
import { api } from "./api";
import { needsFeedRefresh } from "./subscriptions";
import "./news.css";

type Source = {
  title: string;
  url: string;
  content: string;
  published_date?: string | null;
};
type Entry = {
  package: string;
  version: string | null;
  searched_at: string;
  query: string;
  sources: Source[];
  summary?: {
    status: string;
    findings: { category: string; summary: string; source_urls: string[] }[];
    limitations: string[];
  };
};
type Project = {
  analysis_id: string;
  name: string;
  name_in_project: string;
  direct: boolean;
  requirement: string;
};
type Group = {
  name: string;
  ecosystem: string;
  projects: Project[];
  latest: {
    version: string;
    date: string;
    analysis_id: string;
    package: string;
  } | null;
  research: Entry[];
};
type Feed = {
  projects: { analysis_id: string; name: string }[];
  groups: Group[];
};
type Refresh = {
  id: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  current: string | null;
  errors: { package: string; message: string }[];
};
type Analysis = {
  packages: {
    name: string;
    direct: boolean;
    releases: { version: string; date: string | null }[];
  }[];
};

export default function News({
  analysisId,
  onAnalysis,
  onTimeline,
}: {
  analysisId: string | null;
  onAnalysis: (id: string) => void;
  onTimeline: (id: string, pkg: string, version: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [project, setProject] = useState("");
  const [limit, setLimit] = useState(30);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["news-feed-status"],
    queryFn: async () => {
      const previous = queryClient.getQueryData<Refresh | null>([
        "news-feed-status",
      ]);
      const next = await api<Refresh | null>("/news/feed-status");
      if (needsFeedRefresh(previous, next))
        void queryClient.invalidateQueries({ queryKey: ["news-feed"] });
      return next;
    },
    refetchInterval: (query) =>
      ["running", "cancelling"].includes(query.state.data?.status || "")
        ? 1500
        : false,
  });
  const feed = useQuery({
    queryKey: ["news-feed"],
    queryFn: () => api<Feed>("/news/feed"),
    refetchOnWindowFocus: true,
  });
  const analysis = useQuery({
    queryKey: ["news-analysis", analysisId],
    queryFn: () => api<Analysis>(`/timeline/analyses/${analysisId}`),
    enabled: !!analysisId,
  });
  const active = ["running", "cancelling"].includes(status.data?.status || "");
  const groups = useMemo(
    () =>
      (feed.data?.groups || [])
        .filter(
          (group) =>
            group.name.toLowerCase().includes(filter.toLowerCase().trim()) &&
            (!project ||
              group.projects.some((item) => item.analysis_id === project)),
        )
        .sort(
          (a, b) =>
            (b.research[0]?.searched_at || "").localeCompare(
              a.research[0]?.searched_at || "",
            ) ||
            (b.latest?.date || "").localeCompare(a.latest?.date || "") ||
            a.name.localeCompare(b.name),
        ),
    [feed.data, filter, project],
  );
  const dependency = analysis.data?.packages.find((item) => item.name === name);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      await api("/news/refresh", {
        analysis_id: project || null,
        query: filter.trim(),
      });
      await status.refetch();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not refresh the feed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!status.data) return;
    try {
      await api(`/news/refresh/${status.data.id}/cancel`, {});
      await status.refetch();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not cancel the refresh.",
      );
    }
  }
  async function research() {
    if (!analysisId || !name) return;
    setBusy(true);
    setError("");
    try {
      await api("/timeline/research", {
        analysis_id: analysisId,
        package: name,
        version,
      });
      await feed.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="feed-page">
      <header className="feed-header">
        <div>
          <h1>What’s new</h1>
          <p>Release intelligence for the dependencies across your projects.</p>
        </div>
        <button
          className="primary"
          disabled={busy || active || !groups.length}
          onClick={refresh}
        >
          <RefreshCw size={15} /> Refresh {groups.length}{" "}
          {groups.length === 1 ? "library" : "libraries"}
        </button>
      </header>
      <div className="feed-intro">
        <span className="feed-intro-icon" aria-hidden="true">
          <Info size={16} />
        </span>
        <div>
          <strong>
            {feed.isPending
              ? "Loading libraries…"
              : `${feed.data?.groups.length ?? 0} libraries`}
          </strong>
          <span>
            {" "}
            across {feed.data?.projects.length ?? 0} saved project analyses
          </span>
          <p>
            The feed is saved locally. Refresh searches Tavily once per matching
            library, including those not yet shown, and may use credits; package
            names, including private names, are sent to Tavily. Returned
            excerpts may be sent to the configured model. Use the project and
            name filters to limit the search. Related entries may be optional
            and are not necessarily installed.
          </p>
        </div>
      </div>
      {active && status.data && (
        <div className="feed-progress" role="status">
          <RefreshCw className="feed-spin" size={17} />
          <div>
            <strong>Researching {status.data.current || "libraries"}</strong>
            <p>
              {status.data.completed} of {status.data.total} completed ·{" "}
              {status.data.failed} failed
            </p>
            <span
              className="feed-progress-bar"
              aria-hidden="true"
              style={
                {
                  "--done": status.data.total
                    ? status.data.completed / status.data.total
                    : 0,
                  "--bad": status.data.total
                    ? status.data.failed / status.data.total
                    : 0,
                } as CSSProperties
              }
            >
              <i />
              <b />
            </span>
          </div>
          <button
            onClick={cancel}
            disabled={status.data.status === "cancelling"}
          >
            Cancel
          </button>
        </div>
      )}
      {!active && status.data?.failed ? (
        <p className="error" role="alert">
          {status.data.failed} searches failed. Completed results are preserved.{" "}
          {status.data.errors
            .slice(0, 3)
            .map((item) => `${item.package}: ${item.message}`)
            .join(" · ")}
        </p>
      ) : null}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="feed-tools">
        <label className="feed-filter">
          <Search size={16} />

          <input
            type="search"
            aria-label="Filter libraries"
            placeholder="Filter libraries"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(30);
            }}
          />
        </label>
        <label>
          Project{" "}
          <select
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setLimit(30);
            }}
          >
            <option value="">All projects</option>
            {feed.data?.projects.map((item) => (
              <option value={item.analysis_id} key={item.analysis_id}>
                {item.name} · {item.analysis_id.slice(0, 6)}
              </option>
            ))}
          </select>
        </label>
        <span>
          {Math.min(limit, groups.length)} of {groups.length} shown
        </span>
      </div>
      <details className="feed-specific">
        <summary>Research a specific release</summary>
        <div className="news-setup">
          <label>
            Project
            <select
              value={analysisId || ""}
              onChange={(e) => {
                onAnalysis(e.target.value);
                setName("");
                setVersion("");
              }}
            >
              <option value="">Choose a project</option>
              {analysisId &&
                !feed.data?.projects.some(
                  (item) => item.analysis_id === analysisId,
                ) && (
                  <option value={analysisId}>
                    Current analysis · {analysisId.slice(0, 6)}
                  </option>
                )}
              {feed.data?.projects.map((item) => (
                <option value={item.analysis_id} key={item.analysis_id}>
                  {item.name} · {item.analysis_id.slice(0, 6)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dependency
            <select
              value={name}
              disabled={!analysis.data}
              onChange={(e) => {
                setName(e.target.value);
                setVersion("");
              }}
            >
              <option value="">Choose a dependency</option>
              {analysis.data?.packages.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Release
            <select
              value={version}
              disabled={!dependency}
              onChange={(e) => setVersion(e.target.value)}
            >
              <option value="">All releases</option>
              {dependency?.releases.map((item) => (
                <option key={item.version} value={item.version}>
                  {item.version}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!name || busy || active} onClick={research}>
            {busy ? "Searching…" : "Search release"}
          </button>
        </div>
        <p>
          Search sends the selected dependency and version to Tavily; returned
          excerpts may be sent to the configured model.
        </p>
      </details>
      {feed.isPending ? (
        <Skeleton rows={6} variant="cards" label="Loading your feed" />
      ) : feed.error ? (
        <p className="error" role="alert">
          {feed.error.message}
        </p>
      ) : !feed.data?.projects.length ? (
        <div className="feed-empty empty-card">
          <span className="empty-icon" aria-hidden="true">
            <Newspaper size={20} />
          </span>
          <h2>Your feed starts with a project</h2>
          <p>
            Analyze a repository in Time Machine. Its dependencies will appear
            here automatically.
          </p>
        </div>
      ) : !groups.length ? (
        <p className="empty empty-card">No libraries match this filter.</p>
      ) : (
        <div className="feed-list">
          {groups.slice(0, limit).map((group, index) => (
            <article
              className={`feed-item ${group.research.length ? "has-research" : ""}`}
              style={{ "--i": index % 30 } as CSSProperties}
              key={`${group.ecosystem}:${group.name}`}
            >
              <div className="feed-item-head">
                <div>
                  <div className="feed-item-meta">
                    <span className={`feed-eco eco-${group.ecosystem}`}>
                      {group.ecosystem === "node"
                        ? "JavaScript"
                        : group.ecosystem}
                    </span>
                    <span>·</span>
                    <span>
                      {group.projects.length} project{" "}
                      {group.projects.length === 1 ? "analysis" : "analyses"}
                    </span>
                  </div>
                  <h2>{group.name}</h2>
                </div>
                {group.latest && (
                  <button
                    className="feed-open"
                    onClick={() =>
                      onTimeline(
                        group.latest!.analysis_id,
                        group.latest!.package,
                        group.latest!.version,
                      )
                    }
                  >
                    Explore timeline <ArrowRight size={14} />
                  </button>
                )}
              </div>
              {group.latest ? (
                <p className="feed-release">
                  <span className="feed-release-label">Latest dated</span>
                  <strong>{group.latest.version}</strong>
                  <span>
                    {new Date(group.latest.date).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </p>
              ) : (
                <p className="feed-release">
                  No dated release metadata available.
                </p>
              )}
              <details className="feed-projects">
                <summary>
                  Used or declared in {group.projects.length}{" "}
                  {group.projects.length === 1 ? "analysis" : "analyses"}
                </summary>
                {group.projects.map((item) => (
                  <p key={item.analysis_id}>
                    {item.name} ·{" "}
                    {item.direct ? "direct" : "related; may be optional"} ·{" "}
                    <code>{item.requirement || "unspecified"}</code>
                  </p>
                ))}
              </details>
              {group.research.length ? (
                <div className="feed-evidence">
                  {group.research.slice(0, 2).map((entry, index) => (
                    <div key={`${entry.searched_at}-${index}`}>
                      <p className="feed-evidence-meta">
                        {entry.version
                          ? `Release ${entry.version}`
                          : "Across releases"}{" "}
                        · searched{" "}
                        {new Date(entry.searched_at).toLocaleDateString()} ·
                        sources and model interpretation
                      </p>
                      {entry.summary?.findings.slice(0, 2).map((finding, i) => (
                        <p key={i}>
                          <strong>{finding.category}:</strong> {finding.summary}{" "}
                          {finding.source_urls.map((url, j) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              [{j + 1}]
                            </a>
                          ))}
                        </p>
                      ))}
                      {entry.summary?.status === "unavailable" && (
                        <p>
                          Model summary unavailable. Review the sources
                          directly.
                        </p>
                      )}
                      <details>
                        <summary>
                          {entry.sources.length} source
                          {entry.sources.length === 1 ? "" : "s"}
                        </summary>
                        {entry.sources.map((source) => (
                          <p key={source.url}>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {source.title} <ExternalLink size={12} />
                            </a>{" "}
                            ·{" "}
                            {source.published_date &&
                            !Number.isNaN(Date.parse(source.published_date))
                              ? new Date(
                                  source.published_date,
                                ).toLocaleDateString()
                              : "date unknown"}
                          </p>
                        ))}
                      </details>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="feed-unsearched">
                  No saved research yet. Refresh the feed to search public
                  sources.
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {groups.length > limit && (
        <button
          className="feed-more"
          onClick={() => setLimit((value) => value + 30)}
        >
          Show more libraries · {groups.length - limit} remaining
        </button>
      )}
      <p className="feed-footnote">
        Registry dates describe release availability. Source snippets and model
        interpretations are advisory, not test results. Older project snapshots
        may appear separately when their identity is unknown.
      </p>
    </section>
  );
}
