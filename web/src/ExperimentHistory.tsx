import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { api } from "./api";
import { Pager } from "./ui";
import "./history.css";

type Experiment = {
  id: string;
  project_name: string | null;
  package: string;
  versions: string[];
  selections?: Record<string, string[]>;
  status: string;
  started_at: number | null;
  evaluation?: string | null;
  outcomes: { passed: number; failed: number; inconclusive: number };
};

export default function ExperimentHistory({
  onOpen,
  onNew,
  legacyRedirect,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
  legacyRedirect: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const query = useDeferredValue(search.trim().toLowerCase());
  const history = useQuery({
    queryKey: ["timeline-history"],
    queryFn: () => api<Experiment[]>("/timeline/runs?limit=100"),
    refetchInterval: 5000,
  });
  const filtered = (history.data || []).filter(
    (item) =>
      (!status || item.status === status) &&
      (!query ||
        [
          item.project_name,
          item.package,
          item.id,
          JSON.stringify(item.selections || {}),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)),
  );
  const rows = filtered.slice(page * 10, page * 10 + 10);
  return (
    <section className="experiment-history">
      <header className="page-heading inline">
        <div>
          <h1>Experiment history</h1>
          <p>Return to a saved dependency experiment and its evidence.</p>
        </div>
        <button className="primary" onClick={onNew}>
          Open time machine
        </button>
      </header>
      {legacyRedirect && (
        <p className="history-notice" role="status">
          This link opened an older Docker rehearsal. That page has been
          retired; its records remain stored locally. Below are your Time
          Machine experiments.
        </p>
      )}
      <div className="filters">
        <input
          type="search"
          aria-label="Search experiments"
          placeholder="Search project, dependency or run"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="Filter experiments"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="running">Running</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
          <option value="interrupted">Interrupted</option>
        </select>
      </div>
      {history.isPending ? (
        <p role="status">Loading experiments…</p>
      ) : history.error ? (
        <p className="error" role="alert">
          {history.error.message}
        </p>
      ) : rows.length ? (
        <div className="history-list">
          {rows.map((run) => (
            <button
              key={run.id}
              className="history-row experiment-row"
              onClick={() => onOpen(run.id)}
            >
              <div>
                <strong>{run.project_name || "Project unavailable"}</strong>
                {run.evaluation && (
                  <small>Controlled evaluation: {run.evaluation}</small>
                )}
                <small>
                  {Object.entries(
                    run.selections || { [run.package]: run.versions },
                  )
                    .map(
                      ([name, versions]) => `${name}: ${versions.join(", ")}`,
                    )
                    .join(" · ")}
                </small>
                <small>
                  {run.outcomes?.passed || 0} passed ·{" "}
                  {run.outcomes?.failed || 0} failed ·{" "}
                  {run.outcomes?.inconclusive || 0} inconclusive
                </small>
              </div>
              <span className="experiment-status">{run.status}</span>
              <time>
                {run.started_at
                  ? new Date(run.started_at * 1000).toLocaleString()
                  : "Date unavailable"}
              </time>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>No matching experiments</h2>
          <p>Start a Sandbox experiment or adjust your filters.</p>
        </div>
      )}
      <Pager
        page={page}
        size={10}
        total={filtered.length}
        onChange={setPage}
        busy={history.isFetching}
      />
      <p className="history-note">
        Showing up to the 100 most recent local experiments. Results apply to
        their recorded tests and environment.
      </p>
    </section>
  );
}
