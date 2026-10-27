import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Upload } from "lucide-react";
import {
  api,
  repo,
  shortRef,
  type DiscoverySpec,
  type Run,
  type RunSpec,
} from "./api";
import { emptySpec, namedSpec, SetupEditor } from "./SetupEditor";

export default function Composer({
  onCreated,
  busy,
  seed,
  discovery,
}: {
  onCreated: (run: Run) => void;
  busy: boolean;
  seed?: RunSpec;
  discovery?: DiscoverySpec;
}) {
  const [manual, setManual] = useState(!!seed);
  const [spec, setSpec] = useState(
    seed || {
      ...emptySpec(),
      upstream: discovery?.upstream || "",
      baseline_ref: discovery?.baseline_ref || "",
      candidate_ref: discovery?.candidate_ref || "",
    },
  );
  const [editing, setEditing] = useState(!seed);
  const [repositories, setRepositories] = useState(
    discovery?.consumers.join("\n") || "",
  );
  const prepare = useMutation({
    mutationFn: (value: DiscoverySpec) => api<Run>("/runs/prepare", value),
    onSuccess: onCreated,
  });
  const start = useMutation({
    mutationFn: (value: RunSpec) => api<Run>("/runs", namedSpec(value)),
    onSuccess: onCreated,
  });
  const load = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 256_000)
        throw new Error("Choose a setup file smaller than 256 KB.");
      let value: unknown;
      try {
        value = JSON.parse(await file.text());
      } catch {
        throw new Error(
          "This file is not readable JSON. Choose an Oriclus setup or evidence export.",
        );
      }
      const input =
        value && typeof value === "object" && "request" in value
          ? value.request
          : value;
      return api<RunSpec>("/setup/validate", input);
    },
    onSuccess: (value) => {
      setSpec(value);
      setManual(true);
      setEditing(false);
    },
  });
  const example = useMutation({
    mutationFn: () => api<RunSpec>("/example"),
    onSuccess: (value) => {
      setSpec(value);
      setManual(true);
      setEditing(false);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    prepare.mutate({
      upstream: spec.upstream,
      baseline_ref: spec.baseline_ref,
      candidate_ref: spec.candidate_ref,
      consumers: repositories
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
    });
  };
  return (
    <div className={`compose ${manual ? "manual-compose" : ""}`}>
      <header className="page-heading">
        <h1>
          {manual ? "Review your check" : "Check a change before release"}
        </h1>
        <p>
          {manual
            ? "Start with this setup, or edit what runs."
            : "Find projects that use your Python package, test the change, and review fixes."}
        </p>
      </header>
      <div className="compose-layout">
        <div className="setup-panel">
          {manual ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                start.mutate(spec);
              }}
            >
              <p>{repo(spec.upstream) || "Choose a repository"}</p>
              {spec.baseline_ref && spec.candidate_ref && (
                <p className="helper">
                  {shortRef(spec.baseline_ref)} → {shortRef(spec.candidate_ref)}{" "}
                  · {spec.consumers.length} downstream projects
                </p>
              )}
              <details
                className="disclosure"
                open={editing}
                onToggle={(event) => setEditing(event.currentTarget.open)}
                onInvalid={() => setEditing(true)}
              >
                <summary>Edit setup</summary>
                <SetupEditor spec={spec} onChange={setSpec} />
              </details>
              {start.error && (
                <p role="alert" className="error">
                  {start.error.message}
                </p>
              )}
              <p className="helper">
                Runs the selected repositories’ code in Docker. Keep this
                workspace local.
              </p>
              <div className="actions">
                <button className="primary" disabled={busy || start.isPending}>
                  {start.isPending ? "Starting…" : "Start check"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setManual(false)}
                >
                  Use automatic setup
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={submit}>
              <h2>Repository and change</h2>
              <p className="form-intro">
                Start with a public Python library. Review the proposed projects
                before any code runs.
              </p>
              <label htmlFor="repository">GitHub repository</label>
              <div className="repository-entry">
                <input
                  id="repository"
                  required
                  value={spec.upstream}
                  onChange={(e) =>
                    setSpec({ ...spec, upstream: e.target.value })
                  }
                  placeholder="owner/library or GitHub URL"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <label className="change-entry">
                <span>
                  Change to evaluate <span className="optional">optional</span>
                </span>
                <input
                  value={spec.candidate_ref}
                  onChange={(e) =>
                    setSpec({ ...spec, candidate_ref: e.target.value })
                  }
                  placeholder="Branch, tag or commit"
                  aria-describedby="change-hint"
                  autoComplete="off"
                  spellCheck={false}
                />
                <small id="change-hint">
                  Leave blank to use the default branch.
                </small>
              </label>
              <details className="disclosure options">
                <summary>
                  Compare with {spec.baseline_ref || "latest stable release"}{" "}
                  <span>options</span>
                </summary>
                <label>
                  Compare against
                  <input
                    value={spec.baseline_ref}
                    onChange={(e) =>
                      setSpec({ ...spec, baseline_ref: e.target.value })
                    }
                    placeholder="Latest stable release"
                  />
                </label>
                <label>
                  Specific projects to test
                  <textarea
                    rows={3}
                    value={repositories}
                    onChange={(e) => setRepositories(e.target.value)}
                    placeholder="One GitHub repository per line, up to 3"
                  />
                </label>
              </details>
              {prepare.error && (
                <p role="alert" className="error">
                  {prepare.error.message}
                </p>
              )}
              <button className="primary" disabled={busy || prepare.isPending}>
                {prepare.isPending ? "Preparing…" : "Prepare check"}
                <ArrowRight size={17} />
              </button>
            </form>
          )}
          <div className="setup-alternatives">
            {!manual && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setSpec((previous) => ({
                    ...previous,
                    upstream: previous.upstream.replace(
                      /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/,
                      "https://github.com/$1",
                    ),
                  }));
                  setEditing(true);
                  setManual(true);
                }}
              >
                Manual setup
              </button>
            )}
            <label className="file-input">
              <Upload size={15} />
              <span>{load.isPending ? "Reading…" : "Import setup"}</span>
              <input
                type="file"
                accept=".json,application/json"
                aria-label="Import setup JSON"
                disabled={load.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) load.mutate(file);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className="text-button"
              disabled={example.isPending}
              onClick={() => example.mutate()}
            >
              Try an example
            </button>
          </div>
          {(load.error || example.error) && (
            <p className="error" role="alert">
              {load.error?.message || example.error?.message}
            </p>
          )}
        </div>
        {!manual && (
          <aside className="workflow-guide" aria-label="How a check works">
            <h2>From change to evidence</h2>
            <ol>
              <li>
                <strong>Discover projects</strong>
                <p>
                  The model reads source and finds projects that use your
                  package.
                </p>
              </li>
              <li>
                <strong>Review the setup</strong>
                <p>
                  Confirm the projects and tests. Adjust only what you need.
                </p>
              </li>
              <li>
                <strong>Compare and repair</strong>
                <p>
                  Run both versions, inspect failures, and review verified
                  fixes.
                </p>
              </li>
            </ol>
            <p className="scope-note">
              Checks cover the selected tests. Passing patches still need your
              review.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
