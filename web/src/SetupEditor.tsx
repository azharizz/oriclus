import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  api,
  repo,
  shortRef,
  type ConsumerSpec,
  type Run,
  type RunSpec,
} from "./api";

export const blankConsumer = (): ConsumerSpec => ({
  repository: "",
  ref: "HEAD",
  install_command: "",
  test_command: "",
  editable_paths: [],
});
export const emptySpec = (): RunSpec => ({
  title: "",
  upstream: "",
  baseline_ref: "",
  candidate_ref: "",
  package: "",
  repair_attempts: 1,
  consumers: [blankConsumer()],
});

export function SetupEditor({
  spec,
  onChange,
}: {
  spec: RunSpec;
  onChange: (spec: RunSpec) => void;
}) {
  const set = <K extends keyof RunSpec>(key: K, value: RunSpec[K]) =>
    onChange({ ...spec, [key]: value });
  const consumer = (index: number, patch: Partial<ConsumerSpec>) =>
    set(
      "consumers",
      spec.consumers.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    );
  return (
    <div className="setup-editor">
      <label>
        Repository
        <input
          type="url"
          required
          value={spec.upstream}
          onChange={(e) => set("upstream", e.target.value)}
          placeholder="https://github.com/owner/library"
        />
      </label>
      <div className="field-pair">
        <label>
          From
          <input
            required
            value={spec.baseline_ref}
            onChange={(e) => set("baseline_ref", e.target.value)}
            placeholder="Tag or commit"
          />
        </label>
        <label>
          To
          <input
            required
            value={spec.candidate_ref}
            onChange={(e) => set("candidate_ref", e.target.value)}
            placeholder="Tag, branch or commit"
          />
        </label>
      </div>
      <div className="field-pair">
        <label>
          Python package
          <input
            required
            value={spec.package}
            onChange={(e) => set("package", e.target.value)}
          />
        </label>
        <label>
          Repair attempts
          <select
            value={spec.repair_attempts}
            onChange={(e) => set("repair_attempts", Number(e.target.value))}
          >
            <option value={0}>Check only</option>
            <option value={1}>1 attempt</option>
            <option value={2}>2 attempts</option>
            <option value={3}>3 attempts</option>
          </select>
        </label>
      </div>
      <label>
        <span>
          Name <span className="optional">optional</span>
        </span>
        <input
          maxLength={120}
          value={spec.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Named from your package and versions"
        />
      </label>
      <div className="section-heading">
        <h2>Downstream projects</h2>
        <button
          type="button"
          className="text-button"
          disabled={spec.consumers.length >= 10}
          onClick={() => set("consumers", [...spec.consumers, blankConsumer()])}
        >
          <Plus size={16} />
          Add project
        </button>
      </div>
      {spec.consumers.map((item, index) => (
        <fieldset key={index} className="consumer-editor">
          <legend>{repo(item.repository) || `Project ${index + 1}`}</legend>
          <div className="field-pair repository-ref">
            <label>
              Repository
              <input
                type="url"
                required
                value={item.repository}
                onChange={(e) =>
                  consumer(index, { repository: e.target.value })
                }
                placeholder="https://github.com/owner/project"
              />
            </label>
            <label>
              Ref
              <input
                required
                value={item.ref}
                onChange={(e) => consumer(index, { ref: e.target.value })}
              />
            </label>
          </div>
          <label>
            Install command
            <textarea
              required
              rows={2}
              value={item.install_command}
              onChange={(e) =>
                consumer(index, { install_command: e.target.value })
              }
              spellCheck={false}
            />
          </label>
          <label>
            Test command
            <textarea
              required
              rows={2}
              value={item.test_command}
              onChange={(e) =>
                consumer(index, { test_command: e.target.value })
              }
              spellCheck={false}
            />
          </label>
          <label>
            Editable source directories
            <input
              required
              value={item.editable_paths.join(", ")}
              onChange={(e) =>
                consumer(index, {
                  editable_paths: e.target.value
                    .split(",")
                    .map((path) => path.trim()),
                })
              }
              placeholder="src/package/, package/"
            />
          </label>
          <button
            type="button"
            className="text-button danger"
            disabled={spec.consumers.length === 1}
            onClick={() =>
              set(
                "consumers",
                spec.consumers.filter((_, i) => i !== index),
              )
            }
          >
            <Trash2 size={15} />
            Remove project
          </button>
        </fieldset>
      ))}
    </div>
  );
}

export const namedSpec = (spec: RunSpec): RunSpec => ({
  ...spec,
  title:
    spec.title.trim() ||
    `${spec.package}: ${shortRef(spec.baseline_ref)} to ${shortRef(spec.candidate_ref)}`.slice(
      0,
      120,
    ),
});

export function ReviewSetup({
  run,
  busy,
  onStarted,
}: {
  run: Run;
  busy: boolean;
  onStarted: (run: Run) => void;
}) {
  const [spec, setSpec] = useState(run.request);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const start = useMutation({
    mutationFn: (value: RunSpec) =>
      api<Run>(`/runs/${run.id}/start`, namedSpec(value)),
    onSuccess: onStarted,
  });
  const selected = spec.consumers.filter(
    (_, index) => !excluded.includes(index),
  );
  const edit = (next: RunSpec) => {
    if (next.consumers.length < spec.consumers.length) {
      setExcluded((previous) =>
        previous
          .map((index) => next.consumers.indexOf(spec.consumers[index]))
          .filter((index) => index >= 0),
      );
    }
    setSpec(next);
  };
  const version = (field: "baseline_ref" | "candidate_ref") => {
    const original =
      field === "baseline_ref"
        ? run.proposal?.versions.baseline
        : run.proposal?.versions.candidate;
    return spec.upstream === run.request.upstream &&
      spec[field] === run.request[field] &&
      original
      ? original
      : shortRef(spec[field]);
  };
  return (
    <form
      className="review-setup"
      onSubmit={(e) => {
        e.preventDefault();
        start.mutate({ ...spec, consumers: selected });
      }}
    >
      <h2>Proposed check</h2>
      <p>
        {run.proposal?.summary || "Review the proposed projects, then start."}
      </p>
      <div className="version-line">
        <span>{version("baseline_ref")}</span>
        <span aria-label="to">→</span>
        <span>{version("candidate_ref")}</span>
        {[
          spec.baseline_ref,
          spec.candidate_ref,
          ...selected.map((item) => item.ref),
        ].every((ref) => /^[a-f0-9]{40}$/.test(ref)) && (
          <small>commits pinned</small>
        )}
      </div>
      <div className="proposed-projects">
        {spec.consumers.map((item, index) => {
          const evidence = run.proposal?.evidence.find(
            (source) =>
              source.repository === item.repository && source.sha === item.ref,
          );
          return (
            <div className="proposed-project" key={index}>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!excluded.includes(index)}
                  onChange={(e) =>
                    setExcluded((previous) =>
                      e.target.checked
                        ? previous.filter((value) => value !== index)
                        : [...previous, index],
                    )
                  }
                />
                <span>
                  <strong>{repo(item.repository)}</strong>
                  <small>
                    {shortRef(item.ref)} ·{" "}
                    {evidence?.reason || "Manually configured"}
                  </small>
                </span>
              </label>
              <details className="compact-disclosure">
                <summary>Tests and source</summary>
                <p className="helper">Ref: {shortRef(item.ref)}</p>
                <p>Test command</p>
                <pre>{item.test_command}</pre>
                <p>Install command</p>
                <pre>{item.install_command}</pre>
                {evidence && (
                  <>
                    <a href={evidence.url} target="_blank" rel="noreferrer">
                      {evidence.path} at {shortRef(evidence.sha)}
                    </a>
                    <pre>{evidence.excerpt}</pre>
                  </>
                )}
              </details>
            </div>
          );
        })}
      </div>
      {!!run.proposal?.limitations.length && (
        <details className="disclosure">
          <summary>
            Coverage limits <span>{run.proposal.limitations.length}</span>
          </summary>
          <ul>
            {run.proposal.limitations.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </details>
      )}
      <details
        className="disclosure"
        open={editing}
        onToggle={(event) => setEditing(event.currentTarget.open)}
        onInvalid={() => setEditing(true)}
      >
        <summary>Edit setup</summary>
        <p className="helper">
          Source citations describe the original proposal. Your edits determine
          what runs.
        </p>
        <SetupEditor spec={spec} onChange={edit} />
      </details>
      <p className="helper">
        Starting runs these repositories’ install and test code in Docker. This
        is a proposed setup; no tests have run yet.
      </p>
      {start.error && (
        <p className="error" role="alert">
          {start.error.message}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || start.isPending || selected.length === 0}
      >
        {start.isPending
          ? "Starting…"
          : `Check ${selected.length} ${selected.length === 1 ? "project" : "projects"}`}
      </button>
    </form>
  );
}
