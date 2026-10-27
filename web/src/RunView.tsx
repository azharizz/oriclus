import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download, FileDiff, Square } from "lucide-react";
import {
  active,
  api,
  pretty,
  repo,
  shortRef,
  type Attempt,
  type Consumer,
  type Execution,
  type Page,
  type Research,
  type Run,
  type RunEvent,
} from "./api";
import { Pager, Status } from "./ui";

function testOutcome(
  execution: Execution | null | undefined,
  running: boolean,
) {
  return execution
    ? execution.exit_code === 0
      ? "passed"
      : "failed"
    : running
      ? "pending"
      : "not run";
}

function TestOutput({
  name,
  execution,
}: {
  name: string;
  execution: Execution | null;
}) {
  return (
    <details className="disclosure">
      <summary>
        {name}
        <span>{execution ? `exit ${execution.exit_code}` : "Not run"}</span>
      </summary>
      <pre>{execution?.output || "No output recorded."}</pre>
      {execution?.truncated && (
        <p className="helper">
          Earlier output was omitted at the storage limit.
        </p>
      )}
    </details>
  );
}

function Patch({ attempt, runId }: { attempt: Attempt; runId: string }) {
  const [open, setOpen] = useState(false);
  const patch = useQuery({
    queryKey: ["patch", runId, attempt.patch],
    enabled: open && !!attempt.patch,
    queryFn: async () => {
      const response = await fetch(
        `/api/runs/${runId}/artifacts/${attempt.patch}`,
      );
      if (!response.ok) throw new Error("Could not load the patch.");
      return response.text();
    },
  });
  return (
    <details className="disclosure repair">
      <summary>
        Repair {attempt.number}
        <Status value={attempt.status} />
      </summary>
      {attempt.error && <p className="error">{attempt.error}</p>}
      {attempt.patch && (
        <div className="actions">
          <button
            type="button"
            className="text-button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <FileDiff size={15} />
            {open ? "Hide patch" : "View patch"}
          </button>
          <a
            className="text-button"
            href={`/api/runs/${runId}/artifacts/${attempt.patch}`}
            download
          >
            <Download size={15} />
            Download {attempt.status === "verified" ? "patch" : "failed patch"}
          </a>
        </div>
      )}
      {open &&
        (patch.isPending ? (
          <p role="status">Loading patch…</p>
        ) : patch.error ? (
          <p className="error" role="alert">
            {patch.error.message}
            <button onClick={() => patch.refetch()}>Retry</button>
          </p>
        ) : (
          <pre className="diff">
            {patch.data?.split("\n").map((line, i) => (
              <span
                key={i}
                className={
                  line.startsWith("+")
                    ? "addition"
                    : line.startsWith("-")
                      ? "deletion"
                      : ""
                }
              >
                {line}
                {"\n"}
              </span>
            ))}
          </pre>
        ))}
      <TestOutput name="Verification output" execution={attempt.verification} />
      {attempt.explanation && (
        <details className="disclosure">
          <summary>Agent explanation</summary>
          <p className="agent-copy">{attempt.explanation}</p>
        </details>
      )}
    </details>
  );
}

function ConsumerResult({
  summary,
  spec,
  runId,
  running,
}: {
  summary?: Consumer;
  spec: Run["request"]["consumers"][number];
  runId: string;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const result = useQuery({
    queryKey: ["consumer", runId, summary?.index, running],
    enabled: open && !!summary,
    queryFn: () => api<Consumer>(`/runs/${runId}/consumers/${summary!.index}`),
    refetchInterval: open && running ? 3000 : false,
  });
  const consumer = result.data;
  const chosen =
    summary?.attempts.find(
      (item) =>
        item.number === summary?.selection?.candidate &&
        item.status === "verified",
    ) || summary?.attempts.find((item) => item.status === "verified");
  return (
    <div className="consumer-result">
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="result-summary">
          <div>
            <strong>{repo(spec.repository)}</strong>
            <small>{shortRef(spec.ref)}</small>
          </div>
          <span className="test-exits">
            <span>
              <small>Before change</small>
              <strong
                className={`outcome-${testOutcome(summary?.baseline, running)}`}
              >
                {testOutcome(summary?.baseline, running)}
              </strong>
            </span>
            <span>
              <small>After change</small>
              <strong
                className={`outcome-${testOutcome(summary?.candidate, running)}`}
              >
                {testOutcome(summary?.candidate, running)}
              </strong>
            </span>
          </span>
          <Status
            value={summary?.status || (running ? "queued" : "unevaluable")}
          />
          <ChevronDown
            size={17}
            className="disclosure-icon"
            aria-hidden="true"
          />
        </summary>
        <div className="result-body">
          {!summary ? (
            <p>This project was not reached.</p>
          ) : result.isPending ? (
            <p role="status">Loading result…</p>
          ) : result.error ? (
            <p className="error" role="alert">
              {result.error.message}
              <button onClick={() => result.refetch()}>Retry</button>
            </p>
          ) : (
            consumer && (
              <>
                {consumer.error && <p className="error">{consumer.error}</p>}
                {consumer.status === "baseline_failed" && (
                  <p className="helper">
                    The original version failed too. Fix the baseline setup
                    before interpreting this comparison.
                  </p>
                )}
                <TestOutput
                  name="Before the change"
                  execution={consumer.baseline}
                />
                <TestOutput
                  name="After the change, before repair"
                  execution={consumer.candidate}
                />
                {consumer.attempts.map((attempt) => (
                  <Patch key={attempt.number} attempt={attempt} runId={runId} />
                ))}
                {consumer.selection && (
                  <details className="disclosure">
                    <summary>Agent’s patch recommendation</summary>
                    <p>{consumer.selection.rationale}</p>
                    {!!consumer.selection.remaining_risks?.length && (
                      <ul>
                        {consumer.selection.remaining_risks.map((risk, i) => (
                          <li key={i}>{risk}</li>
                        ))}
                      </ul>
                    )}
                  </details>
                )}
              </>
            )
          )}
        </div>
      </details>
      {chosen?.patch && (
        <div className="patch-shortcut">
          <a
            className="text-button"
            href={`/api/runs/${runId}/artifacts/${chosen.patch}`}
            download
          >
            <Download size={15} />
            Download passing patch
          </a>
          <span className="helper">
            Verified separately. Review before applying.
          </span>
        </div>
      )}
    </div>
  );
}

function EventRow({ event, runId }: { event: RunEvent; runId: string }) {
  const [open, setOpen] = useState(false);
  const details = useQuery({
    queryKey: ["event", runId, event.id],
    queryFn: () => api<{ data: unknown }>(`/runs/${runId}/events/${event.id}`),
    enabled: open,
    staleTime: Infinity,
  });
  return (
    <details className="event" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <time dateTime={event.at}>
          {new Date(event.at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </time>
        <strong>{event.title}</strong>
        <span>{event.kind}</span>
        <ChevronDown size={15} className="disclosure-icon" aria-hidden="true" />
      </summary>
      {open &&
        (details.isPending ? (
          <p role="status">Loading detail…</p>
        ) : details.error ? (
          <p className="error" role="alert">
            {details.error.message}
            <button onClick={() => details.refetch()}>Retry</button>
          </p>
        ) : (
          <pre>{pretty(details.data.data)}</pre>
        ))}
    </details>
  );
}

function Activity({ runId, running }: { runId: string; running: boolean }) {
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState("");
  const events = useQuery({
    queryKey: ["events", runId, page, kind, running],
    queryFn: () =>
      api<Page<RunEvent>>(
        `/runs/${runId}/events?limit=15&offset=${page * 15}&kind=${kind}`,
      ),
    refetchInterval: running && page === 0 ? 2000 : false,
    refetchOnWindowFocus: page === 0,
  });
  return (
    <section aria-label="Activity">
      <div className="section-heading">
        <h2>Activity</h2>
        <select
          aria-label="Filter activity"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All activity</option>
          <option value="execution">Test and command output</option>
          <option value="model">Model calls</option>
          <option value="planning">Discovery</option>
          <option value="research">Web research</option>
          <option value="error">Errors</option>
        </select>
      </div>
      {events.isPending ? (
        <p role="status">Loading activity…</p>
      ) : events.error ? (
        <p className="error" role="alert">
          {events.error.message}
          <button onClick={() => events.refetch()}>Retry</button>
        </p>
      ) : (
        <>
          {events.data.items.length ? (
            <div className="event-list">
              {events.data.items.map((event) => (
                <EventRow key={event.id} event={event} runId={runId} />
              ))}
            </div>
          ) : (
            <p className="empty">No activity in this view.</p>
          )}
          <Pager
            page={page}
            size={15}
            total={events.data.total}
            onChange={setPage}
            busy={events.isFetching}
          />
        </>
      )}
    </section>
  );
}

function Sources({ runId, running }: { runId: string; running: boolean }) {
  const [page, setPage] = useState(0);
  const sources = useQuery({
    queryKey: ["sources", runId, page, running],
    queryFn: () =>
      api<Page<Research>>(`/runs/${runId}/research?offset=${page * 5}`),
    refetchInterval: running ? 5000 : false,
  });
  return (
    <section className="sources">
      <h2>Sources</h2>
      <p className="helper">Research context, not proof that a test passed.</p>
      {sources.isPending ? (
        <p role="status">Loading sources…</p>
      ) : sources.error ? (
        <p role="alert" className="error">
          {sources.error.message}
          <button onClick={() => sources.refetch()}>Retry</button>
        </p>
      ) : (
        <>
          {sources.data.items.length ? (
            sources.data.items.map((source, i) => (
              <details className="disclosure" key={`${page}-${i}`}>
                <summary>
                  {source.query}
                  <span>
                    {source.status === "failed"
                      ? "Unavailable"
                      : `${source.results.length} sources`}
                  </span>
                </summary>
                {source.error && <p className="error">{source.error}</p>}
                {source.status === "completed" && !source.results.length && (
                  <p>No sources returned.</p>
                )}
                <ul className="source-list">
                  {source.results.map((item, index) => (
                    <li key={index}>
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.title || item.url}
                      </a>
                      <details className="compact-disclosure">
                        <summary>Excerpt</summary>
                        <p>{item.content}</p>
                      </details>
                    </li>
                  ))}
                </ul>
                {source.request_id && (
                  <p className="helper mono">
                    Request {source.request_id}
                    {source.usage?.credits !== undefined
                      ? ` · ${source.usage.credits} credits`
                      : ""}
                  </p>
                )}
              </details>
            ))
          ) : (
            <p className="empty">No web research recorded.</p>
          )}
          <Pager
            page={page}
            size={5}
            total={sources.data.total}
            onChange={setPage}
          />
        </>
      )}
    </section>
  );
}

function Results({ run }: { run: Run }) {
  const [page, setPage] = useState(0);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const rows = run.request.consumers.map((spec, index) => ({
    spec,
    result: run.consumers.find((item) => item.index === index),
  }));
  const visible = issuesOnly
    ? rows.filter((row) =>
        row.result
          ? [
              "regressed",
              "repair_available",
              "baseline_failed",
              "unevaluable",
              "cancelled",
              "interrupted",
              "failed",
            ].includes(row.result.status)
          : !active(run.status),
      )
    : rows;
  const passed = run.consumers.filter(
    (item) => item.status === "compatible",
  ).length;
  const broken = run.consumers.filter((item) =>
    ["regressed", "repair_available"].includes(item.status),
  ).length;
  const patches = run.consumers.filter(
    (item) => item.status === "repair_available",
  ).length;
  const incomplete = rows.length - passed - broken;
  return (
    <section className="results">
      <div className="section-heading">
        <h2>Project results</h2>
        <label className="check-label filter-check">
          <input
            type="checkbox"
            checked={issuesOnly}
            onChange={(e) => {
              setIssuesOnly(e.target.checked);
              setPage(0);
            }}
          />
          Needs attention
        </label>
      </div>
      {!!rows.length && (
        <p className="result-totals">
          {passed} passed unchanged · {broken} failed after the change
          {patches ? ` · ${patches} with passing patches` : ""}
          {incomplete ? ` · ${incomplete} incomplete comparisons` : ""}
        </p>
      )}
      {visible.length ? (
        <div className="consumer-results">
          {visible
            .slice(page * 5, page * 5 + 5)
            .map(({ spec, result }, index) => (
              <ConsumerResult
                key={`${spec.repository}-${spec.ref}-${page * 5 + index}`}
                summary={result}
                spec={spec}
                runId={run.id}
                running={active(run.status)}
              />
            ))}
        </div>
      ) : (
        <p className="empty">
          {issuesOnly
            ? "No issues recorded so far. Incomplete comparisons are not passes."
            : active(run.status)
              ? "Preparing the upstream change…"
              : "No downstream projects were checked."}
        </p>
      )}
      <Pager page={page} size={5} total={visible.length} onChange={setPage} />
      <p className="helper">
        Results cover the selected tests only. Passing patches still need code
        review.
      </p>
      {run.analysis && (
        <details className="disclosure">
          <summary>
            Change analysis <span>model-generated</span>
          </summary>
          <p>{run.analysis.summary}</p>
          {!!run.analysis.changed_contracts?.length && (
            <ul>
              {run.analysis.changed_contracts.map((contract, i) => (
                <li key={i}>{contract}</li>
              ))}
            </ul>
          )}
          {!!run.analysis.evidence_limits?.length && (
            <p className="helper">{run.analysis.evidence_limits.join(" ")}</p>
          )}
        </details>
      )}
      {run.assessment && (
        <details className="disclosure">
          <summary>
            Release assessment <span>model-generated</span>
          </summary>
          <p className="helper">
            Advisory. Verify claims against the recorded results. Oriclus never
            merges patches.
          </p>
          <h3>{run.assessment.recommendation}</h3>
          <p>{run.assessment.rationale}</p>
          {!!run.assessment.limitations?.length && (
            <ul>
              {run.assessment.limitations.map((limit, i) => (
                <li key={i}>{limit}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </section>
  );
}

export default function RunView({ id }: { id: string }) {
  const [tab, setTab] = useState("results");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["run", id],
    queryFn: () => api<Run>(`/runs/${id}?brief=true`),
    refetchInterval: (state) =>
      active(state.state.data?.status) ? 2000 : false,
  });
  const cancel = useMutation({
    mutationFn: () => api(`/runs/${id}/cancel`, {}),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["run", id] });
      client.invalidateQueries({ queryKey: ["health"] });
    },
  });
  if (query.isPending)
    return (
      <p className="empty" role="status">
        Loading check…
      </p>
    );
  if (query.error)
    return (
      <div className="error" role="alert">
        {query.error.message}
        <button onClick={() => query.refetch()}>Retry</button>
      </div>
    );
  const run = query.data;
  const running = active(run.status);
  const planning = run.status === "planning";
  return (
    <>
      <header className="run-heading">
        <div>
          <h1>{run.request.title}</h1>
          <p>
            {repo(run.request.upstream)}
            {run.request.baseline_ref && run.request.candidate_ref
              ? ` · ${shortRef(run.request.baseline_ref)} → ${shortRef(run.request.candidate_ref)}`
              : ""}
            {" · Docker rehearsal"}
          </p>
        </div>
        <Status value={run.status} />
      </header>
      <div className="run-toolbar">
        <time dateTime={run.created_at}>
          {new Date(run.created_at).toLocaleString()}
        </time>
        <div className="actions">
          <a className="text-button" href={`/api/runs/${id}/export`} download>
            <Download size={15} />
            Export
          </a>
          {running ? (
            <button
              className="text-button danger"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending || cancel.isSuccess}
            >
              <Square size={13} />
              {cancel.isSuccess ? "Cancelling…" : "Cancel"}
            </button>
          ) : null}
        </div>
      </div>
      {cancel.error && (
        <p className="error" role="alert">
          {cancel.error.message}
        </p>
      )}
      {run.error && (
        <p className="error" role="alert">
          {run.error}
        </p>
      )}
      {running && (
        <div className="progress-note" role="status">
          <span className="activity-dot" />
          <div>
            <strong>
              {planning
                ? "Finding projects and reading their setup"
                : run.activity || "Starting check"}
            </strong>
            {planning && (
              <p>
                You can leave this page. The proposal will be saved in History.
              </p>
            )}
          </div>
        </div>
      )}
      {run.status === "ready" ? (
        <p className="empty">
          This historical setup is read-only. Start a new experiment in Time
          Machine.
        </p>
      ) : (
        <>
          <div className="view-tabs" role="group" aria-label="Result views">
            {["results", "sources", "activity"].map((value) => (
              <button
                key={value}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {value === "results"
                  ? planning
                    ? "Setup"
                    : "Results"
                  : value === "sources"
                    ? "Sources"
                    : "Activity"}
              </button>
            ))}
          </div>
          {tab === "activity" ? (
            <Activity runId={id} running={running} />
          ) : tab === "sources" ? (
            <Sources runId={id} running={running} />
          ) : planning ? (
            <div className="planning-progress">
              <p>{run.activity || "Reading repository metadata"}</p>
              <button
                className="text-button"
                onClick={() => setTab("activity")}
              >
                View activity
              </button>
            </div>
          ) : (
            <Results run={run} />
          )}
        </>
      )}
    </>
  );
}
