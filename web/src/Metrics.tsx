import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import "./news.css";

type Metrics = {
  completion: { completed: number; terminal: number };
  first_result_seconds: { median: number | null; count: number };
  repair: { verified: number; attempts: number };
};
function percent(n: number, d: number) {
  return d ? `${((100 * n) / d).toFixed(1)}%` : "No data";
}
export default function Metrics() {
  const query = useQuery({
    queryKey: ["metrics"],
    queryFn: () => api<Metrics>("/timeline/metrics"),
    refetchInterval: 10000,
  });
  return (
    <section className="news-page">
      <header className="page-heading">
        <h1>Experiment metrics</h1>
        <p>Recorded outcomes from this local workspace.</p>
      </header>
      {query.isPending ? (
        <p role="status">Loading measurements…</p>
      ) : query.error ? (
        <p className="error" role="alert">
          {query.error.message}
        </p>
      ) : (
        <dl className="settings-list">
          <div>
            <dt>Experiment completion</dt>
            <dd>
              <strong>
                {percent(
                  query.data.completion.completed,
                  query.data.completion.terminal,
                )}
              </strong>{" "}
              · {query.data.completion.completed} completed /{" "}
              {query.data.completion.terminal} terminal runs. Failed, cancelled
              and interrupted runs count in the denominator; active runs do not.
            </dd>
          </div>
          <div>
            <dt>Time to first useful result</dt>
            <dd>
              <strong>
                {query.data.first_result_seconds.median === null
                  ? "No data"
                  : `${query.data.first_result_seconds.median.toFixed(1)} seconds median`}
              </strong>{" "}
              · {query.data.first_result_seconds.count} timed runs. Measured
              from run creation to the first passing or failing candidate; older
              runs without timestamps are excluded.
            </dd>
          </div>
          <div>
            <dt>Repair verification</dt>
            <dd>
              <strong>
                {percent(
                  query.data.repair.verified,
                  query.data.repair.attempts,
                )}
              </strong>{" "}
              · {query.data.repair.verified} verified /{" "}
              {query.data.repair.attempts} recorded attempts, including
              unavailable attempts.
            </dd>
          </div>
        </dl>
      )}
      <p className="news-note">
        These are local operational measurements, not a comparison with uv and
        not a measure of general compatibility.
      </p>
    </section>
  );
}
