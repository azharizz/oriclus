import { ChevronLeft, ChevronRight } from "lucide-react";
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
