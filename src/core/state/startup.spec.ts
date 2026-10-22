import { advanceStartupPlayback, createStartupPlayback, currentStartupFrame, loadedFrameIndices, settleStartupTask, shouldDismissStartup, skipToStartupFinalFrame } from './startup';
it('skips failed assets, holds the final frame, and never replays', () => {
  let state = createStartupPlayback(loadedFrameIndices(['loaded', 'failed', 'loaded']));
  state = advanceStartupPlayback(state); expect(currentStartupFrame(state)).toBe(2);
  state = advanceStartupPlayback(state); expect(state.finished).toBe(true);
  expect(advanceStartupPlayback(state)).toBe(state);
  expect(shouldDismissStartup(false, true, true)).toBe(false);
  expect(shouldDismissStartup(true, true, false)).toBe(false);
  expect(shouldDismissStartup(true, true, true)).toBe(true);
});
it('reduced motion uses the final usable frame and empty frames permit a static fallback', () => {
  expect(currentStartupFrame(createStartupPlayback([0, 5, 9], true))).toBe(9);
  expect(currentStartupFrame(skipToStartupFinalFrame(createStartupPlayback([0, 5])))).toBe(5);
  expect(createStartupPlayback([]).finished).toBe(true);
});
it('bounds optional work and releases it on cancellation', async () => {
  jest.useFakeTimers();
  const pending = settleStartupTask(() => new Promise(() => {}), 100);
  await jest.advanceTimersByTimeAsync(100); expect(await pending).toEqual({ status: 'timed-out' });
  const controller = new AbortController();
  const cancelled = settleStartupTask(() => new Promise(() => {}), 100, controller.signal);
  controller.abort(); expect(await cancelled).toEqual({ status: 'cancelled' });
  jest.useRealTimers();
});
