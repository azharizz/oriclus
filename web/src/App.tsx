import { useDeferredValue, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  History as HistoryIcon,
  CalendarDays,
  PanelLeft,
  Newspaper,
  BarChart3,
  Settings2,
} from "lucide-react";
import mark from "./mark.svg";
import News from "./News";
import Metrics from "./Metrics";
import Timeline from "./Timeline";
import RunView from "./RunView";
import { Pager, Status } from "./ui";
import {
  api,
  repo,
  shortRef,
  type Health,
  type Page,
  type RunSummary,
} from "./api";

const subscribeLocation = (changed: () => void) => {
  window.addEventListener("popstate", changed);
  return () => window.removeEventListener("popstate", changed);
};
const locationSnapshot = () => window.location.search;

function History({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const queryText = useDeferredValue(search);
  const history = useQuery({
    queryKey: ["runs", page, queryText, status],
    queryFn: () =>
      api<Page<RunSummary>>(
        `/runs?limit=10&offset=${page * 10}&q=${encodeURIComponent(queryText)}&status=${status}`,
      ),
    refetchInterval: 5000,
  });
  return (
    <>
      <header className="page-heading inline">
        <h1>Historical Docker checks</h1>
        <button className="primary" onClick={onNew}>
          Open time machine
        </button>
      </header>
      <div className="filters">
        <input
          type="search"
          aria-label="Search checks"
          maxLength={120}
          placeholder="Search by repository or name"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="Filter checks"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All statuses</option>
          <option value="ready">Ready to start</option>
          <option value="planning">Finding a setup</option>
          <option value="running">Running</option>
          <option value="completed">Finished</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
          <option value="interrupted">Interrupted</option>
        </select>
      </div>
      {history.isPending ? (
        <p className="empty" role="status">
          Loading checks…
        </p>
      ) : history.error ? (
        <div className="error" role="alert">
          {history.error.message}
          <button onClick={() => history.refetch()}>Retry</button>
        </div>
      ) : (
        <>
          {history.data.items.length ? (
            <div className="history-list">
              {history.data.items.map((run) => (
                <button
                  className="history-row"
                  key={run.id}
                  onClick={() => onOpen(run.id)}
                >
                  <div>
                    <strong>{run.request.title}</strong>
                    <small>
                      {repo(run.request.upstream)}
                      {run.request.baseline_ref && run.request.candidate_ref
                        ? ` · ${shortRef(run.request.baseline_ref)} → ${shortRef(run.request.candidate_ref)}`
                        : ""}
                      {run.consumer_count > 0
                        ? ` · ${run.consumer_count} projects`
                        : ""}
                    </small>
                  </div>
                  <Status value={run.status} />
                  <time dateTime={run.created_at}>
                    {new Date(run.created_at).toLocaleDateString()}
                    <span>
                      {new Date(run.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </time>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">
              <h2>
                {search || status ? "No matching checks" : "No checks yet"}
              </h2>
              <p>
                {search || status
                  ? "Change your search or filter."
                  : "Start with a repository to see what its changes affect."}
              </p>
              {!search && !status && (
                <button className="primary" onClick={onNew}>
                  Open time machine
                </button>
              )}
            </div>
          )}
          <Pager
            page={page}
            size={10}
            total={history.data.total}
            onChange={setPage}
            busy={history.isFetching}
          />
        </>
      )}
    </>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 600);
  const search = useSyncExternalStore(subscribeLocation, locationSnapshot);
  const params = new URLSearchParams(search);
  const runId = params.get("run");
  const page = params.get("page") || "timeline";
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [timelineTarget, setTimelineTarget] = useState<{
    id: string;
    package: string;
    version: string;
  } | null>(null);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
    refetchInterval: 5000,
  });
  const navigate = (query: string) => {
    window.history.pushState(null, "", window.location.pathname + query);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo({ top: 0 });
  };
  const newCheck = () => navigate("");
  const open = (id: string) => navigate(`?run=${encodeURIComponent(id)}`);
  const openTimeline = (id: string, pkg: string, version: string) => {
    setTimelineTarget({ id, package: pkg, version });
    navigate("");
  };
  return (
    <div className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <header className="app-header">
        <button
          className="sidebar-toggle"
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={sidebarOpen}
          aria-controls="workspace-navigation"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <PanelLeft size={16} />
        </button>
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("");
          }}
          aria-label="Oriclus home"
        >
          <span className="brand-name">Oriclus</span>
          <img src={mark} alt="" width="30" height="30" />
          <span className="brand-purpose">
            Dependency
            <br />
            workspace
          </span>
        </a>
        <span className="workspace-name">Local workspace</span>
        <a
          className="header-docs"
          href="https://docs.tokenfactory.nebius.com/"
          target="_blank"
          rel="noreferrer"
        >
          <BookOpen size={15} /> Nebius documentation <ExternalLink size={14} />
        </a>
      </header>
      <aside
        className="app-sidebar"
        id="workspace-navigation"
        aria-label="Workspace navigation"
        hidden={!sidebarOpen}
      >
        <nav aria-label="Main navigation">
          <p className="nav-heading">Workspace</p>
          <button
            aria-current={!runId && page === "timeline" ? "page" : undefined}
            onClick={() => navigate("")}
          >
            <CalendarDays size={17} />
            Time machine
          </button>
          <button
            aria-current={!runId && page === "news" ? "page" : undefined}
            onClick={() => navigate("?page=news")}
          >
            <Newspaper size={17} /> What’s new
          </button>
          <button
            aria-current={!runId && page === "metrics" ? "page" : undefined}
            onClick={() => navigate("?page=metrics")}
          >
            <BarChart3 size={17} /> Metrics
          </button>
          <button
            aria-current={runId || page === "history" ? "page" : undefined}
            onClick={() => navigate("?page=history")}
          >
            <HistoryIcon size={17} />
            History
          </button>
          <p className="nav-heading">Settings</p>
          <button
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => navigate("?page=settings")}
          >
            <Settings2 size={16} />
            <span>Connections</span>
          </button>
        </nav>
        <div className="sidebar-note">
          <strong>Oriclus workspace</strong>
          <span>Explore version history</span>
          <span>Test changes with evidence</span>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        {health.error && (
          <p className="error" role="alert">
            Cannot reach Oriclus. Check that the local server is running.
            <button onClick={() => health.refetch()}>Retry</button>
          </p>
        )}
        {runId ? (
          <RunView key={runId} id={runId} />
        ) : page === "history" ? (
          <History onOpen={open} onNew={newCheck} />
        ) : page === "settings" ? (
          <>
            <header className="page-heading">
              <h1>Connections</h1>
              <p>Services used by this local workspace.</p>
            </header>
            {health.isPending ? (
              <p role="status">Loading connections…</p>
            ) : (
              health.data && (
                <dl className="settings-list">
                  <div>
                    <dt>Nebius Sandboxes</dt>
                    <dd>
                      {health.data.sandbox_configured
                        ? "Configured; access is checked when an operation starts."
                        : "Add a Sandbox key and project ID to .env."}
                    </dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>
                      {health.data.inference_configured
                        ? health.data.model
                        : "Add the three NEBIUS values to .env."}
                    </dd>
                  </div>
                  <div>
                    <dt>Tavily</dt>
                    <dd>
                      {health.data.tavily_configured
                        ? "Configured"
                        : "Add TAVILY_API_KEY to .env for dependency research."}
                    </dd>
                  </div>
                </dl>
              )
            )}
            <details className="disclosure">
              <summary>Environment details</summary>
              <p>
                Keys stay in the project’s .env. Restart the server after
                changing them. Version resolution sends project files to Nebius
                and runs package-manager commands; tests run after you start an
                experiment.
              </p>
              <p>
                Keep this local execution service on localhost and use
                repositories you trust. Historical Docker records remain
                accessible in History.
              </p>
            </details>
          </>
        ) : page === "news" ? (
          <News
            analysisId={analysisId}
            onAnalysis={setAnalysisId}
            onTimeline={openTimeline}
          />
        ) : page === "metrics" ? (
          <Metrics />
        ) : (
          <Timeline
            onAnalysis={setAnalysisId}
            target={timelineTarget}
            onTargetHandled={() => setTimelineTarget(null)}
          />
        )}
      </main>
    </div>
  );
}
