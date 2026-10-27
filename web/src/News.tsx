import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { api } from "./api";
import "./news.css";

type Release = { version: string; date: string | null };
type Analysis = {
  id: string;
  ecosystem: string;
  manager: string;
  packages: { name: string; direct: boolean; releases: Release[] }[];
};
type Recent = { analysis_id: string; package: string; id: string };
type Entry = {
  package: string;
  version: string | null;
  searched_at: string;
  query: string;
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

export default function News({
  analysisId,
  onAnalysis,
  onTimeline,
}: {
  analysisId: string | null;
  onAnalysis: (id: string) => void;
  onTimeline: (id: string, pkg: string, version: string) => void;
}) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recent = useQuery({
    queryKey: ["news-projects"],
    queryFn: () => api<Recent[]>("/timeline/runs?limit=100"),
  });
  const analysis = useQuery({
    queryKey: ["news-analysis", analysisId],
    queryFn: () => api<Analysis>(`/timeline/analyses/${analysisId}`),
    enabled: !!analysisId,
  });
  const history = useQuery({
    queryKey: ["news", analysisId],
    queryFn: () => api<Entry[]>(`/timeline/research/${analysisId}`),
    enabled: !!analysisId,
  });
  const packages = analysis.data?.packages || [];
  const dependency = packages.find((p) => p.name === name);
  const choices = [
    ...new Map((recent.data || []).map((r) => [r.analysis_id, r])).values(),
  ];
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
      await history.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="news-page">
      <header className="page-heading">
        <h1>What’s new</h1>
        <p>
          Discover release notes, features and migration guidance for your
          project’s dependencies.
        </p>
      </header>
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
            <option value="">Choose a recent project</option>
            {analysisId &&
              !choices.some((r) => r.analysis_id === analysisId) && (
                <option value={analysisId}>
                  Current project · {analysisId.slice(0, 8)}
                </option>
              )}
            {choices.map((r) => (
              <option key={r.analysis_id} value={r.analysis_id}>
                {r.package} · project {r.analysis_id.slice(0, 8)}
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
            {packages.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.direct ? " · direct" : " · related"}
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
            <option value="">Latest and historical information</option>
            {dependency?.releases.map((r) => (
              <option value={r.version} key={r.version}>
                {r.version}
                {r.date
                  ? ` · ${new Date(r.date).toLocaleDateString()}`
                  : " · date unknown"}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!name || busy} onClick={research}>
          <Search size={15} />
          {busy ? "Searching…" : "Search sources"}
        </button>
        <p>
          Search sends only the selected package name and version to Tavily.
          These names may be private. Results are public sources, not proof of
          compatibility. Searches may use credits.
        </p>
      </div>
      {(error || analysis.error || history.error) && (
        <p className="error" role="alert">
          {error || analysis.error?.message || history.error?.message}
        </p>
      )}
      {busy && (
        <p role="status">
          Searching public sources and preparing an evidence-based model
          summary…
        </p>
      )}
      {!analysisId && (
        <p className="empty">
          Open a project in Time Machine, or choose one from a recent
          experiment.
        </p>
      )}
      {analysisId && !history.isPending && !history.data?.length && (
        <p className="empty">
          Choose a dependency and search to build its source timeline.
        </p>
      )}
      {history.data?.map((entry, index) => (
        <article className="news-entry" key={`${entry.searched_at}-${index}`}>
          <div className="news-entry-head">
            <div>
              <h2>
                {entry.package} {entry.version || "· releases and features"}
              </h2>
              <p>
                Searched {new Date(entry.searched_at).toLocaleString()} · Tavily
                sources
              </p>
            </div>
            {entry.version && (
              <button
                onClick={() =>
                  onTimeline(analysisId!, entry.package, entry.version!)
                }
              >
                Explore release
              </button>
            )}
          </div>
          {entry.summary && (
            <div className="news-summary">
              <strong>Model interpretation · advisory</strong>
              {entry.summary.findings.map((finding, i) => (
                <p key={i}>
                  <b>{finding.category}:</b> {finding.summary}{" "}
                  {finding.source_urls.map((url, j) => (
                    <a href={url} target="_blank" rel="noreferrer" key={url}>
                      [Source {j + 1}]{" "}
                    </a>
                  ))}
                </p>
              ))}
              {entry.summary.limitations.map((limit, i) => (
                <p key={i}>{limit}</p>
              ))}
              {!entry.summary.findings.length &&
                entry.summary.status === "completed" && (
                  <p>No source-supported findings were returned.</p>
                )}
            </div>
          )}
          {entry.sources.length ? (
            <ol className="news-list">
              {[...entry.sources]
                .sort(
                  (a, b) =>
                    (Date.parse(b.published_date || "") || 0) -
                    (Date.parse(a.published_date || "") || 0),
                )
                .map((source) => (
                  <li key={source.url}>
                    <div className="news-date">
                      {source.published_date &&
                      !Number.isNaN(Date.parse(source.published_date))
                        ? new Date(source.published_date).toLocaleDateString()
                        : "Date unknown"}
                    </div>
                    <div>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title} <ExternalLink size={13} />
                      </a>
                      <p>
                        {source.content.length > 500
                          ? `${source.content.slice(0, 500)}…`
                          : source.content}
                      </p>
                      {source.content.length > 500 && (
                        <details>
                          <summary>Show full search excerpt</summary>
                          <p>{source.content}</p>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
            </ol>
          ) : (
            <p>No sources returned for this search.</p>
          )}
        </article>
      ))}
    </section>
  );
}
