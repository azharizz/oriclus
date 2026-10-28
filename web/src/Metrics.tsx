import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import "./metrics.css";

type Metrics = {
  completion: { completed: number; terminal: number };
  first_result_seconds: { median: number | null; count: number };
  repair: { verified: number; attempts: number };
  run_statuses: Record<string, number>;
  test_outcomes: Record<string, number>;
  duration_bins: number[];
};
function percent(n: number, d: number) {
  return d ? `${((100 * n) / d).toFixed(1)}%` : "No data";
}
function Breakdown({
  label,
  data,
}: {
  label: string;
  data: { name: string; count: number; tone: string }[];
}) {
  const total = data.reduce((n, item) => n + item.count, 0);
  return (
    <div className="metric-breakdown" aria-label={label}>
      <div className="metric-bar" aria-hidden="true">
        {data.map((item) => (
          <span
            key={item.name}
            className={item.tone}
            style={{ width: `${total ? (100 * item.count) / total : 0}%` }}
          />
        ))}
      </div>
      <ul>
        {data.map((item) => (
          <li key={item.name}>
            <i className={item.tone} aria-hidden="true" />
            <span>{item.name}</span>
            <strong>{item.count}</strong>
          </li>
        ))}
      </ul>
      {!total && <p className="metric-note">No recorded results yet.</p>}
    </div>
  );
}
export default function Metrics() {
  const query = useQuery({
    queryKey: ["metrics"],
    queryFn: () => api<Metrics>("/timeline/metrics"),
    refetchInterval: 10000,
  });
  return (
    <section className="metrics-page">
      <header className="page-heading">
        <h1>Experiment metrics</h1>
        <p>Understand the results recorded in this local workspace.</p>
      </header>
      {query.isPending ? (
        <p role="status">Loading measurements…</p>
      ) : query.error ? (
        <p className="error" role="alert">
          {query.error.message}
        </p>
      ) : (
        (() => {
          const m = query.data;
          const bins = m.duration_bins || [0, 0, 0, 0];
          const max = Math.max(...bins, 1);
          return (
            <>
              <div className="metrics-grid">
                <section className="metric-panel">
                  <div className="metric-head">
                    <div>
                      <h2>Experiment completion</h2>
                      <p>Runs that finished, regardless of test outcome</p>
                    </div>
                    <strong>
                      {percent(m.completion.completed, m.completion.terminal)}
                    </strong>
                  </div>
                  <Breakdown
                    label="Terminal experiment statuses"
                    data={[
                      {
                        name: "Completed",
                        count: m.run_statuses.completed,
                        tone: "metric-green",
                      },
                      {
                        name: "Failed",
                        count: m.run_statuses.failed,
                        tone: "metric-red",
                      },
                      {
                        name: "Cancelled",
                        count: m.run_statuses.cancelled,
                        tone: "metric-amber",
                      },
                      {
                        name: "Interrupted",
                        count: m.run_statuses.interrupted,
                        tone: "metric-gray",
                      },
                    ]}
                  />
                  <p className="metric-note">
                    {m.completion.completed} of {m.completion.terminal} terminal
                    runs. Active runs and labeled controlled evaluations are
                    excluded.
                  </p>
                </section>
                <section className="metric-panel">
                  <div className="metric-head">
                    <div>
                      <h2>Repair verification</h2>
                      <p>Proposed patches checked in a fresh branch</p>
                    </div>
                    <strong>
                      {percent(m.repair.verified, m.repair.attempts)}
                    </strong>
                  </div>
                  <Breakdown
                    label="Repair verification outcomes"
                    data={[
                      {
                        name: "Verified",
                        count: m.repair.verified,
                        tone: "metric-green",
                      },
                      {
                        name: "Not verified",
                        count: m.repair.attempts - m.repair.verified,
                        tone: "metric-amber",
                      },
                    ]}
                  />
                  <p className="metric-note">
                    {m.repair.verified} of {m.repair.attempts} recorded
                    attempts; unavailable attempts are included.
                  </p>
                </section>
                <section className="metric-panel">
                  <div className="metric-head">
                    <div>
                      <h2>Candidate test outcomes</h2>
                      <p>Observed results, not resolver predictions</p>
                    </div>
                  </div>
                  <Breakdown
                    label="Candidate test outcomes"
                    data={[
                      {
                        name: "Passed",
                        count: m.test_outcomes.passed,
                        tone: "metric-green",
                      },
                      {
                        name: "Failed",
                        count: m.test_outcomes.failed,
                        tone: "metric-red",
                      },
                      {
                        name: "Inconclusive",
                        count: m.test_outcomes.inconclusive,
                        tone: "metric-gray",
                      },
                    ]}
                  />
                  <p className="metric-note">
                    Results are limited to the commands and environments tested.
                  </p>
                </section>
                <section className="metric-panel">
                  <div className="metric-head">
                    <div>
                      <h2>Time to first useful result</h2>
                      <p>From run creation to first pass or fail</p>
                    </div>
                    <strong>
                      {m.first_result_seconds.median === null
                        ? "No data"
                        : `${m.first_result_seconds.median.toFixed(1)}s`}
                    </strong>
                  </div>
                  <div
                    className="metric-histogram"
                    aria-label="Distribution of timed runs"
                  >
                    {["Under 30s", "30–60s", "60–120s", "120s or more"].map(
                      (label, i) => (
                        <div key={label}>
                          <span>{label}</span>
                          <div className="metric-track" aria-hidden="true">
                            <i style={{ width: `${(100 * bins[i]) / max}%` }} />
                          </div>
                          <strong>{bins[i]}</strong>
                        </div>
                      ),
                    )}
                  </div>
                  <p className="metric-note">
                    Median across {m.first_result_seconds.count} timed runs.
                    Older runs without timestamps are excluded.
                  </p>
                </section>
              </div>
              <p className="metrics-disclaimer">
                These are local operational measurements, not a comparison with
                uv or a guarantee of compatibility. A completed experiment can
                contain failed tests.
              </p>
            </>
          );
        })()
      )}
    </section>
  );
}
