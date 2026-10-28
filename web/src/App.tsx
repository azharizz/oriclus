import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
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
import ExperimentHistory from "./ExperimentHistory";
import Timeline from "./Timeline";
import { api, type Health } from "./api";

const subscribeLocation = (changed: () => void) => {
  window.addEventListener("popstate", changed);
  return () => window.removeEventListener("popstate", changed);
};
const locationSnapshot = () => window.location.search;

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 600);
  const search = useSyncExternalStore(subscribeLocation, locationSnapshot);
  const params = new URLSearchParams(search);
  const legacyRun = params.has("run");
  const timelineRunId = params.get("timeline_run");
  const page = legacyRun ? "history" : params.get("page") || "timeline";
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
  useEffect(() => {
    if (legacyRun) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?page=history&legacy=1`,
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [legacyRun]);
  const navigate = (query: string) => {
    window.history.pushState(null, "", window.location.pathname + query);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo({ top: 0 });
  };
  const newCheck = () => navigate("");
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
            aria-current={page === "timeline" ? "page" : undefined}
            onClick={() => navigate("")}
          >
            <CalendarDays size={17} />
            Time machine
          </button>
          <button
            aria-current={page === "news" ? "page" : undefined}
            onClick={() => navigate("?page=news")}
          >
            <Newspaper size={17} /> What’s new
          </button>
          <button
            aria-current={page === "metrics" ? "page" : undefined}
            onClick={() => navigate("?page=metrics")}
          >
            <BarChart3 size={17} /> Metrics
          </button>
          <button
            aria-current={page === "history" ? "page" : undefined}
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
        {page === "history" ? (
          <ExperimentHistory
            onOpen={(id) => navigate(`?timeline_run=${encodeURIComponent(id)}`)}
            onNew={newCheck}
            legacyRedirect={legacyRun || params.get("legacy") === "1"}
          />
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
                repositories you trust. Older Docker records remain stored
                locally.
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
            initialRunId={timelineRunId}
          />
        )}
      </main>
    </div>
  );
}
