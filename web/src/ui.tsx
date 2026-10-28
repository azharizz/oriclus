import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Maximize2,
  Minimize2,
  WrapText,
} from "lucide-react";
import { label } from "./api";

export function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{label(value)}</span>;
}

export function Pager({
  page,
  size,
  total,
  onChange,
  busy = false,
}: {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
  busy?: boolean;
}) {
  if (total <= size && page === 0) return null;
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        {total === 0
          ? "No results"
          : `${page * size + 1}–${Math.min((page + 1) * size, total)} of ${total}`}
      </span>
      <div>
        <button
          type="button"
          aria-label="Previous page"
          disabled={page === 0 || busy}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span className="pagination-dots" aria-hidden="true">
          {Array.from({ length: Math.min(pages, 9) }, (_, i) => (
            <i key={i} className={i === Math.min(page, 8) ? "is-on" : ""} />
          ))}
        </span>
        <span>
          Page {page + 1} of {pages}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={page + 1 >= pages || busy}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </nav>
  );
}

/** Shimmering placeholder that mirrors the layout it replaces. */
export function Skeleton({
  rows = 3,
  label: text = "Loading",
  variant = "rows",
}: {
  rows?: number;
  label?: string;
  variant?: "rows" | "cards";
}) {
  return (
    <div
      className={`skeleton skeleton-${variant}`}
      role="status"
      aria-live="polite"
    >
      <span className="skeleton-label">
        <i className="live-dot" /> {text}
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          className="skeleton-item"
          key={i}
          style={{ "--i": i } as CSSProperties}
        >
          <i style={{ width: `${46 + ((i * 17) % 38)}%` }} />
          <i style={{ width: `${24 + ((i * 29) % 30)}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Seconds since mount, for honest "how long has this taken" feedback. */
export function useElapsed(running = true) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return Math.floor((now - start) / 1000);
}
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const LINE_LIMIT = 1500;
const tone = (line: string, diff: boolean) =>
  diff
    ? line.startsWith("+") && !line.startsWith("+++")
      ? "log-add"
      : line.startsWith("-") && !line.startsWith("---")
        ? "log-del"
        : line.startsWith("@@")
          ? "log-hunk"
          : ""
    : /\b(error|failed|failure|traceback|exception|panic|fatal)\b|^E\s/i.test(
          line,
        )
      ? "log-err"
      : /\b(warn(ing)?|deprecat\w*)\b/i.test(line)
        ? "log-warn"
        : /\b(passed|ok|success(ful)?)\b|✓/i.test(line)
          ? "log-ok"
          : "";

/**
 * Bounded viewer for test output, installation logs and patches. Long output
 * stays inside a scroll region with line numbers, copy, wrap and tail controls;
 * very long output shows the tail first because failures are usually there.
 */
export function LogView({
  text,
  title = "Output",
  empty = "No output available.",
  diff = false,
}: {
  text?: string | null;
  title?: string;
  empty?: string;
  diff?: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [wrap, setWrap] = useState(true);
  const [tall, setTall] = useState(false);
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = useMemo(
    () => (text || "").replace(/\n$/, "").split("\n"),
    [text],
  );
  const hidden = all ? 0 : Math.max(0, lines.length - LINE_LIMIT);
  const shown = hidden ? lines.slice(hidden) : lines;
  const counts = useMemo(
    () =>
      diff
        ? null
        : {
            err: lines.filter((line) => tone(line, false) === "log-err").length,
          },
    [lines, diff],
  );
  if (!text?.trim()) return <p className="log-empty">{empty}</p>;
  return (
    <figure className={`log ${tall ? "is-tall" : ""}`}>
      <figcaption className="log-bar">
        <span className="log-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <strong>{title}</strong>
        <span className="log-meta">
          {lines.length.toLocaleString()} line{lines.length === 1 ? "" : "s"}
          {!!counts?.err && (
            <em>
              {counts.err} error line{counts.err === 1 ? "" : "s"}
            </em>
          )}
        </span>
        <span className="log-actions">
          <button
            type="button"
            aria-pressed={wrap}
            title="Wrap long lines"
            aria-label="Wrap long lines"
            onClick={() => setWrap(!wrap)}
          >
            <WrapText size={14} />
          </button>
          <button
            type="button"
            title="Jump to end"
            aria-label="Jump to end of output"
            onClick={() =>
              body.current?.scrollTo({
                top: body.current.scrollHeight,
                behavior: "smooth",
              })
            }
          >
            <ArrowDownToLine size={14} />
          </button>
          <button
            type="button"
            title={tall ? "Collapse" : "Expand"}
            aria-label={tall ? "Collapse output" : "Expand output"}
            onClick={() => setTall(!tall)}
          >
            {tall ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            title="Copy"
            aria-label="Copy output"
            onClick={() =>
              navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              })
            }
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </span>
      </figcaption>
      {hidden > 0 && (
        <button type="button" className="log-more" onClick={() => setAll(true)}>
          {hidden.toLocaleString()} earlier lines hidden · show all
        </button>
      )}
      <div
        className={`log-body ${wrap ? "is-wrapped" : ""}`}
        ref={body}
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        <pre>
          {shown.map((line, i) => (
            <span key={i} className={tone(line, diff)} data-n={hidden + i + 1}>
              {line || " "}
              {"\n"}
            </span>
          ))}
        </pre>
      </div>
    </figure>
  );
}
