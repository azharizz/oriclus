import { useDeferredValue, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  History as HistoryIcon,
  CalendarDays,
  PanelLeft,
  Plus,
  Settings2,
} from "lucide-react";
import mark from "./mark.svg";
import Composer from "./Composer";
import Timeline from "./Timeline";
import RunView from "./RunView";
import { Pager, Status } from "./ui";
import {
  api,
  repo,
  shortRef,
  type DiscoverySpec,
  type Health,
  type Page,
  type Run,
  type RunSpec,
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
        <h1>Your checks</h1>
        <button className="primary" onClick={onNew}>
          New check
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
                  Check a repository
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
  const [draft, setDraft] = useState<{
    key: number;
    spec?: RunSpec;
    discovery?: DiscoverySpec;
  }>({ key: 0 });
  const client = useQueryClient();
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
  const newCheck = () => {
    setDraft((previous) => ({ key: previous.key + 1 }));
    navigate("?page=rehearsal");
  };
  const open = (id: string) => navigate(`?run=${encodeURIComponent(id)}`);
  const created = (run: Run) => {
    client.setQueryData(["run", run.id], run);
    client.invalidateQueries({ queryKey: ["health"] });
    client.invalidateQueries({ queryKey: ["runs"] });
    open(run.id);
  };
  const reuse = (run: Run) => {
    setDraft((previous) => ({
      key: previous.key + 1,
      spec: run.request.consumers.length ? run.request : undefined,
      discovery: run.discovery,
    }));
    navigate("?page=rehearsal");
  };
  const busy = !!health.data?.active_run;
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
            aria-current={!runId && page === "rehearsal" ? "page" : undefined}
            onClick={newCheck}
          >
            <Plus size={17} />
            Release rehearsal
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
        {health.data?.active_run && health.data.active_run.id !== runId && (
          <button
            className="active-banner"
            onClick={() => open(health.data!.active_run!.id)}
          >
            <span>
              A check is active: <strong>{health.data.active_run.title}</strong>
            </span>
            <span>
              View progress <ArrowRight size={15} />
            </span>
          </button>
        )}
        {runId ? (
          <RunView
            key={runId}
            id={runId}
            busy={busy}
            onReuse={reuse}
            onStarted={created}
          />
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
                    <dt>Docker</dt>
                    <dd>
                      {health.data.docker && health.data.image
                        ? "Ready"
                        : !health.data.docker
                          ? "Start Docker Desktop."
                          : "Build the sandbox image using the README setup command."}
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
                        : "Add TAVILY_API_KEY to .env for discovery."}
                    </dd>
                  </div>
                </dl>
              )
            )}
            <details className="disclosure">
              <summary>Environment details</summary>
              <p>
                Keys stay in the project’s .env. Restart the server after
                changing them. Discovery reads public GitHub source;
                installation and tests run only after you start a check.
              </p>
              <p>
                Existing release rehearsals use Docker. Time machine experiments
                use Nebius Sandboxes when configured. Review the recorded
                environment and execution results for each run.
              </p>
              <p>
                Keep this Docker-controlling service on localhost and use
                repositories you trust.
              </p>
            </details>
          </>
        ) : page === "rehearsal" ? (
          <Composer
            key={draft.key}
            seed={draft.spec}
            discovery={draft.discovery}
            busy={busy}
            onCreated={created}
          />
        ) : (
          <Timeline />
        )}
      </main>
    </div>
  );
}
