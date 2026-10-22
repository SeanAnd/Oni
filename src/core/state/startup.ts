/** Pure one-shot playback rules, independent of React Native and wall clocks. */
export type FrameLoadState = 'pending' | 'loaded' | 'failed';
export interface StartupPlayback {
  readonly frames: readonly number[];
  readonly position: number;
  readonly finished: boolean;
}

export function loadedFrameIndices(states: readonly FrameLoadState[]): number[] {
  return states.flatMap((state, index) => state === 'loaded' ? [index] : []);
}

export function createStartupPlayback(frames: readonly number[], reduceMotion = false): StartupPlayback {
  return {
    frames: [...frames],
    position: reduceMotion ? Math.max(0, frames.length - 1) : 0,
    finished: frames.length === 0,
  };
}

export function currentStartupFrame(playback: StartupPlayback): number | null {
  return playback.frames[playback.position] ?? null;
}

/** The last frame gets its own display interval. It never wraps to frame zero. */
export function advanceStartupPlayback(playback: StartupPlayback): StartupPlayback {
  if (playback.finished) return playback;
  if (playback.position < playback.frames.length - 1) {
    return { ...playback, position: playback.position + 1 };
  }
  return { ...playback, finished: true };
}

/** Enabling reduced motion skips forward; disabling it never restarts playback. */
export function skipToStartupFinalFrame(playback: StartupPlayback): StartupPlayback {
  const position = Math.max(0, playback.frames.length - 1);
  return position === playback.position ? playback : { ...playback, position };
}

export function shouldDismissStartup(appReady: boolean, animationFinished: boolean, active: boolean): boolean {
  return appReady && animationFinished && active;
}

export type StartupTaskResult<T> =
  | { status: 'ready'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'timed-out' }
  | { status: 'cancelled' };

/**
 * Bound optional asset/accessibility work and release timers on cleanup.
 * This is deliberately NOT used to synthesize authentication or app readiness.
 * Cancellation stops observation, not a download already started by the OS.
 */
export function settleStartupTask<T>(
  task: () => Promise<T>, timeoutMs: number, signal?: AbortSignal,
): Promise<StartupTaskResult<T>> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve({ status: 'cancelled' }); return; }
    let settled = false;
    const finish = (result: StartupTaskResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ status: 'cancelled' });
    const timer = setTimeout(() => finish({ status: 'timed-out' }), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    void Promise.resolve().then(() => {
      if (signal?.aborted) return;
      return task();
    }).then(
      value => finish({ status: 'ready', value: value as T }),
      error => finish({ status: 'failed', error }),
    );
  });
}
