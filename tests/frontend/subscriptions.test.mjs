import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  elapsedClock,
  animatedNumber,
  needsFeedRefresh,
} from "../../web/src/subscriptions.ts";

test("elapsed clock updates on ticks and cleans up its interval", () => {
  const originalWindow = globalThis.window;
  const originalNow = Date.now;
  let tick, cleared;
  try {
    globalThis.window = {
      setInterval(callback, delay) {
        assert.equal(delay, 1000);
        tick = callback;
        return 17;
      },
      clearInterval(id) {
        cleared = id;
      },
    };
    Date.now = () => 3500;
    const clock = elapsedClock(1000);
    let changes = 0;
    const stop = clock.subscribe(() => changes++);
    assert.equal(clock.getSnapshot(), 0);
    tick();
    assert.equal(clock.getSnapshot(), 2);
    assert.equal(changes, 1);
    tick();
    assert.equal(changes, 1);
    stop();
    assert.equal(cleared, 17);
  } finally {
    globalThis.window = originalWindow;
    Date.now = originalNow;
  }
});

test("animated numbers respect reduced motion without scheduling a frame", () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    const animation = animatedNumber(42);
    assert.equal(animation.getSnapshot(), 42);
    animation.subscribe(() => {
      throw Error("should not animate");
    })();
  } finally {
    globalThis.window = originalWindow;
  }
});

test("animated numbers update, finish, and cancel scheduled frames", () => {
  const originalWindow = globalThis.window;
  const originalRAF = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let frame, cancelled;
  try {
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    globalThis.requestAnimationFrame = (callback) => {
      frame = callback;
      return 23;
    };
    globalThis.cancelAnimationFrame = (id) => {
      cancelled = id;
    };
    const animation = animatedNumber(100);
    let changes = 0;
    const stop = animation.subscribe(() => changes++);
    const start = performance.now();
    frame(start + 450);
    assert.ok(animation.getSnapshot() > 0 && animation.getSnapshot() < 100);
    frame(start + 1000);
    assert.equal(animation.getSnapshot(), 100);
    assert.equal(changes, 2);
    stop();
    assert.equal(cancelled, 23);
  } finally {
    globalThis.window = originalWindow;
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

test("news feed refreshes when progress advances or a refresh terminates", () => {
  const status = (state, completed, id = "one") => ({
    id,
    status: state,
    completed,
  });
  assert.equal(needsFeedRefresh(null, status("running", 0)), false);
  assert.equal(
    needsFeedRefresh(status("running", 0), status("running", 1)),
    true,
  );
  assert.equal(
    needsFeedRefresh(status("running", 1), status("running", 1)),
    false,
  );
  assert.equal(
    needsFeedRefresh(status("running", 1), status("completed", 1)),
    true,
  );
  assert.equal(
    needsFeedRefresh(status("completed", 1), status("completed", 1)),
    false,
  );
  assert.equal(
    needsFeedRefresh(status("completed", 1), status("cancelled", 1, "two")),
    true,
  );
  assert.equal(needsFeedRefresh(status("running", 1), null), false);
});
