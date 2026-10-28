/** A clock whose interval exists only while a component subscribes. */
export function elapsedClock(start: number) {
  let seconds = 0;
  return {
    getSnapshot: () => seconds,
    subscribe: (notify: () => void) => {
      const timer = window.setInterval(() => {
        const next = Math.floor((Date.now() - start) / 1000);
        if (next !== seconds) {
          seconds = next;
          notify();
        }
      }, 1000);
      return () => window.clearInterval(timer);
    },
  };
}

/** Each subscription owns its animation frame and cancels it on replacement. */
export function animatedNumber(target: number) {
  let value = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? target
    : 0;
  return {
    getSnapshot: () => value,
    subscribe: (notify: () => void) => {
      if (value === target) return () => {};
      const start = performance.now();
      let frame = 0;
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / 900);
        value = target * (1 - (1 - progress) ** 3);
        notify();
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    },
  };
}

type FeedStatus = { id: string; status: string; completed: number };

export function needsFeedRefresh(
  previous: FeedStatus | null | undefined,
  next: FeedStatus | null,
) {
  if (!next) return false;
  const hasResults =
    (next.status === "running" && next.completed > 0) ||
    ["completed", "cancelled", "failed"].includes(next.status);
  return (
    hasResults &&
    (previous?.id !== next.id ||
      previous.status !== next.status ||
      previous.completed !== next.completed)
  );
}
