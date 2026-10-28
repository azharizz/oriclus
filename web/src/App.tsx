import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ExternalLink,
  History as HistoryIcon,
  CalendarDays,
  PanelLeftClose,
  PanelLeftOpen,
  Newspaper,
  BarChart3,
  Settings2,
  Box,
  Command,
  Cpu,
  Globe,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import mark from "./mark.svg";
import News from "./News";
import Metrics from "./Metrics";
import ExperimentHistory from "./ExperimentHistory";
import Timeline from "./Timeline";
import CommandPalette from "./CommandPalette";
import { api, type Health } from "./api";
import { Skeleton } from "./ui";

const subscribeLocation = (changed: () => void) => {
  window.addEventListener("popstate", changed);
  return () => window.removeEventListener("popstate", changed);
};
const locationSnapshot = () => window.location.search;
const pages = [
  {
    id: "timeline",
    query: "",
    label: "Time machine",
    hint: "Explore releases and test versions",
    icon: CalendarDays,
  },
  {
    id: "news",
    query: "?page=news",
    label: "What’s new",
    hint: "Release research across projects",
    icon: Newspaper,
  },
  {
    id: "metrics",
    query: "?page=metrics",
    label: "Metrics",
    hint: "Recorded experiment outcomes",
    icon: BarChart3,
  },
  {
    id: "history",
    query: "?page=history",
    label: "History",
    hint: "Saved Sandbox experiments",
    icon: HistoryIcon,
  },
  {
    id: "settings",
    query: "?page=settings",
    label: "Connections",
    hint: "Configured services",
    icon: Settings2,
  },
];

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 600);
  const search = useSyncExternalStore(subscribeLocation, locationSnapshot);
  const params = new URLSearchParams(search);
  const legacyRun = params.has("run");
  const timelineRunId = params.get("timeline_run");
  const page = legacyRun ? "history" : params.get("page") || "timeline";
  const current = pages.find((item) => item.id === page) || pages[0];
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [timelineTarget, setTimelineTarget] = useState<{
    id: string;
    package: string;
    version: string;
  } | null>(null);
  const nav = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ top: number; height: number }>();
  useLayoutEffect(() => {
    const active = nav.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    setIndicator(
      active
        ? { top: active.offsetTop, height: active.offsetHeight }
        : undefined,
    );
  }, [page, sidebarOpen]);
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
    stage.current?.scrollTo({ top: 0 });
    if (window.innerWidth <= 600) setSidebarOpen(false);
  };
  const newCheck = () => navigate("");
  const openTimeline = (id: string, pkg: string, version: string) => {
    setTimelineTarget({ id, package: pkg, version });
    navigate("");
  };
  const openRun = (id: string) =>
    navigate(`?timeline_run=${encodeURIComponent(id)}`);
  const connection = health.error
    ? "offline"
    : health.data
      ? health.data.active_run
        ? "busy"
        : "online"
      : "pending";
  return (
    <div className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <aside
        className="app-sidebar"
        id="workspace-navigation"
        aria-label="Workspace navigation"
        inert={!sidebarOpen && window.innerWidth <= 600}
      >
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("");
          }}
          aria-label="Oriclus home"
        >
          <img src={mark} alt="" width="34" height="34" />
          <span className="brand-text">
            <span className="brand-name">Oriclus</span>
            <span className="brand-purpose">Dependency workspace</span>
          </span>
        </a>
        <button
          type="button"
          className="sidebar-search"
          onClick={() => window.dispatchEvent(new Event("oriclus:palette"))}
          aria-label="Open command palette"
        >
          <Command size={15} />
          <span>Jump to…</span>
          <kbd>⌘K</kbd>
        </button>
        <nav aria-label="Main navigation" ref={nav}>
          {indicator && (
            <span
              className="nav-indicator"
              aria-hidden="true"
              style={{
                transform: `translateY(${indicator.top}px)`,
                height: indicator.height,
              }}
            />
          )}
          {pages.map(({ id, query, label, icon: Icon }, index) => (
            <div key={id} className="nav-group">
              {index === 0 && <p className="nav-heading">Workspace</p>}
              {id === "settings" && <p className="nav-heading">Settings</p>}
              <button
                aria-current={page === id ? "page" : undefined}
                data-label={label}
                onClick={() => navigate(query)}
              >
                <span className="nav-icon">
                  <Icon size={17} />
                </span>
                <span className="nav-label">{label}</span>
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-note" aria-label="Service status">
          <strong>Services</strong>
          {[
            ["Sandboxes", health.data?.sandbox_configured],
            ["Model", health.data?.inference_configured],
            ["Tavily", health.data?.tavily_configured],
          ].map(([name, ok]) => (
            <span
              key={String(name)}
              title={`${name}: ${health.data ? (ok ? "ready" : "not set") : "checking"}`}
              className={
                health.data ? (ok ? "is-ok" : "is-missing") : "is-pending"
              }
            >
              <i />
              <span className="nav-label">{name}</span>
              <small>
                {health.data ? (ok ? "Ready" : "Not set") : "Checking"}
              </small>
            </span>
          ))}
          {health.data?.active_run && (
            <button
              type="button"
              className="sidebar-run"
              onClick={() => openRun(health.data!.active_run!.id)}
            >
              <i className="live-dot" />
              <span className="nav-label">
                <b>Running</b>
                {health.data.active_run.title}
              </span>
            </button>
          )}
        </div>
        <button
          className="sidebar-toggle"
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={sidebarOpen}
          aria-controls="workspace-navigation"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? (
            <PanelLeftClose size={16} />
          ) : (
            <PanelLeftOpen size={16} />
          )}
          <span className="nav-label">Collapse</span>
        </button>
      </aside>
      <button
        type="button"
        className="sidebar-scrim"
        aria-label="Close navigation"
        tabIndex={-1}
        onClick={() => setSidebarOpen(false)}
      />
      <div className="app-stage" ref={stage}>
        <header className="app-topbar">
          <button
            type="button"
            className="topbar-menu"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <PanelLeftOpen size={16} />
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>Local workspace</span>
            <ChevronRight size={13} aria-hidden="true" />
            <strong key={current.id}>
              <current.icon size={14} /> {current.label}
            </strong>
            {timelineRunId && page === "timeline" && (
              <>
                <ChevronRight size={13} aria-hidden="true" />
                <code>Run {timelineRunId.slice(0, 8)}</code>
              </>
            )}
          </nav>
          <button
            type="button"
            className="topbar-search"
            onClick={() => window.dispatchEvent(new Event("oriclus:palette"))}
          >
            <Command size={14} />
            <span>Search pages and experiments</span>
            <kbd>⌘K</kbd>
          </button>
          <span className={`topbar-status is-${connection}`} role="status">
            <i className="live-dot" />
            {connection === "offline"
              ? "API offline"
              : connection === "busy"
                ? "Run in progress"
                : connection === "online"
                  ? "Connected"
                  : "Connecting…"}
          </span>
          <a
            className="header-docs"
            href="https://docs.tokenfactory.nebius.com/"
            target="_blank"
            rel="noreferrer"
            aria-label="Nebius documentation"
            title="Nebius documentation"
          >
            <BookOpen size={15} />
            <span>Docs</span>
            <ExternalLink size={13} />
          </a>
        </header>
        <main id="main" tabIndex={-1}>
          {health.error && (
            <p className="error error-offline" role="alert">
              Cannot reach Oriclus. Check that the local server is running.
              <button onClick={() => health.refetch()}>
                <RefreshCw size={14} /> Retry
              </button>
            </p>
          )}
          <div className="page-enter" key={page + (timelineRunId || "")}>
            {page === "history" ? (
              <ExperimentHistory
                onOpen={openRun}
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
                  <Skeleton rows={3} label="Checking connections" />
                ) : (
                  health.data && (
                    <dl className="settings-list">
                      {[
                        {
                          name: "Nebius Sandboxes",
                          icon: Box,
                          ok: health.data.sandbox_configured,
                          text: health.data.sandbox_configured
                            ? "Configured; access is checked when an operation starts."
                            : "Add a Sandbox key and project ID to .env.",
                        },
                        {
                          name: "Model",
                          icon: Cpu,
                          ok: health.data.inference_configured,
                          text: health.data.inference_configured
                            ? health.data.model
                            : "Add the three NEBIUS values to .env.",
                        },
                        {
                          name: "Tavily",
                          icon: Globe,
                          ok: health.data.tavily_configured,
                          text: health.data.tavily_configured
                            ? "Configured"
                            : "Add TAVILY_API_KEY to .env for dependency research.",
                        },
                      ].map(({ name, icon: Icon, ok, text }) => (
                        <div key={name} className={ok ? "is-ok" : "is-missing"}>
                          <dt>
                            <span className="settings-icon">
                              <Icon size={17} />
                            </span>
                            {name}
                          </dt>
                          <dd>{text}</dd>
                          <span className="settings-state">
                            <i />
                            {ok ? "Ready" : "Needs setup"}
                          </span>
                        </div>
                      ))}
                    </dl>
                  )
                )}
                <details className="disclosure">
                  <summary>Environment details</summary>
                  <p>
                    Keys stay in the project’s .env. Restart the server after
                    changing them. Version resolution sends project files to
                    Nebius and runs package-manager commands; tests run after
                    you start an experiment.
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
          </div>
        </main>
      </div>
      <CommandPalette
        onOpenRun={openRun}
        pages={pages.map((item) => ({
          id: item.id,
          label: item.label,
          hint: item.hint,
          icon: item.icon,
          run: () => navigate(item.query),
        }))}
      />
    </div>
  );
}
