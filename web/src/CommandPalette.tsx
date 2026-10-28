import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, FlaskConical, Search } from "lucide-react";
import { api } from "./api";

export type PaletteItem = {
  id: string;
  label: string;
  hint?: string;
  icon: ComponentType<{ size?: number }>;
  run: () => void;
};
type Recent = {
  id: string;
  package: string;
  versions: string[];
  status: string;
  project_name?: string | null;
};

let paletteOpen = false;
const paletteListeners = new Set<() => void>();
function setPaletteOpen(value: boolean) {
  if (paletteOpen === value) return;
  paletteOpen = value;
  paletteListeners.forEach((notify) => notify());
}
function subscribePalette(notify: () => void) {
  paletteListeners.add(notify);
  const onKey = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setPaletteOpen(!paletteOpen);
    }
  };
  const onOpen = () => setPaletteOpen(true);
  window.addEventListener("keydown", onKey);
  window.addEventListener("oriclus:palette", onOpen);
  return () => {
    paletteListeners.delete(notify);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("oriclus:palette", onOpen);
  };
}
const paletteSnapshot = () => paletteOpen;

/** ⌘K / Ctrl+K jump list for pages and recent experiments. */
export default function CommandPalette({
  pages,
  onOpenRun,
}: {
  pages: PaletteItem[];
  onOpenRun: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = useSyncExternalStore(
    subscribePalette,
    paletteSnapshot,
    paletteSnapshot,
  );
  const [previousOpen, setPreviousOpen] = useState(open);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const recent = useQuery({
    queryKey: ["palette-recent"],
    queryFn: () => api<Recent[]>("/timeline/runs?limit=8"),
    enabled: open,
    staleTime: 10000,
  });
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }
  const attachDialog = useCallback((node: HTMLDialogElement | null) => {
    dialog.current = node;
    if (node) {
      if (!node.open) node.showModal();
      node.querySelector("input")?.focus();
      return () => {
        dialog.current = null;
      };
    }
  }, []);

  const needle = query.trim().toLowerCase();
  const items: (PaletteItem & { group: string })[] = [
    ...pages.map((item) => ({ ...item, group: "Go to" })),
    ...(recent.data || []).map((run) => ({
      id: run.id,
      label: `${run.project_name || run.package}`,
      hint: `${run.package} ${run.versions.join(", ")} · ${run.status}`,
      icon: FlaskConical,
      group: "Recent experiments",
      run: () => onOpenRun(run.id),
    })),
  ].filter((item) =>
    `${item.label} ${item.hint || ""}`.toLowerCase().includes(needle),
  );
  const active = Math.min(cursor, Math.max(items.length - 1, 0));
  const choose = (item?: PaletteItem) => {
    if (!item) return;
    setPaletteOpen(false);
    item.run();
  };

  if (!open) return null;
  return (
    <dialog
      ref={attachDialog}
      className="palette"
      aria-label="Command palette"
      onClose={() => setPaletteOpen(false)}
      onClick={(event) =>
        event.target === dialog.current && setPaletteOpen(false)
      }
    >
      {open && (
        <div className="palette-body">
          <label className="palette-input">
            <Search size={17} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              placeholder="Jump to a page or experiment…"
              aria-label="Search pages and experiments"
              aria-controls="palette-list"
              aria-activedescendant={items[active] && `pal-${active}`}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setCursor(
                    (active + step + items.length) % Math.max(items.length, 1),
                  );
                } else if (event.key === "Enter") choose(items[active]);
              }}
            />
            <kbd>Esc</kbd>
          </label>
          <ul id="palette-list" role="listbox" className="palette-list">
            {items.map((item, index) => (
              <li
                key={`${item.group}-${item.id}`}
                id={`pal-${index}`}
                role="option"
                aria-selected={index === active}
                data-group={
                  index === 0 || items[index - 1].group !== item.group
                    ? item.group
                    : undefined
                }
                onMouseMove={() => setCursor(index)}
                onClick={() => choose(item)}
              >
                <span className="palette-icon">
                  <item.icon size={15} />
                </span>
                <span className="palette-text">
                  <strong>{item.label}</strong>
                  {item.hint && <small>{item.hint}</small>}
                </span>
                {index === active && <CornerDownLeft size={14} />}
              </li>
            ))}
            {recent.isFetching && !recent.data && (
              <li className="palette-note">Loading recent experiments…</li>
            )}
            {!items.length && <li className="palette-note">No matches.</li>}
          </ul>
          <footer className="palette-foot">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move
            </span>
            <span>
              <kbd>↵</kbd> open
            </span>
            <span>
              <kbd>⌘</kbd>
              <kbd>K</kbd> toggle
            </span>
          </footer>
        </div>
      )}
    </dialog>
  );
}
