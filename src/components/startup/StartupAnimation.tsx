import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, AppState, Image, StyleSheet, Text, View, useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { assets } from '@/theme/assets';
import {
  advanceStartupPlayback, createStartupPlayback, currentStartupFrame, loadedFrameIndices,
  settleStartupTask, shouldDismissStartup, skipToStartupFinalFrame,
  type FrameLoadState, type StartupPlayback,
} from '@/core/state/startup';
import {
  STARTUP_ASSET_TIMEOUT_MS, STARTUP_BACKGROUND, STARTUP_FINAL_FRAME_DURATION_MS,
  STARTUP_FRAME_ASPECT_RATIO, STARTUP_FRAME_DURATION_MS,
} from './config';
import { startupFrames } from './frames';
import { hideNativeSplash } from './nativeSplash';

export interface StartupAnimationProps {
  appReady: boolean;
  onComplete: () => void;
}

/** A single run per mount. App readiness never controls or restarts the clock. */
export function StartupAnimation({ appReady, onComplete }: StartupAnimationProps) {
  const { width, height } = useWindowDimensions();
  const artworkWidth = Math.min(width, height * STARTUP_FRAME_ASPECT_RATIO, 960);
  const frameStates = useRef<FrameLoadState[]>(startupFrames.map(() => 'pending'));
  const framesFrozen = useRef(false);
  const notified = useRef(false);
  const [readyFrames, setReadyFrames] = useState<readonly number[] | null>(null);
  const [playback, setPlayback] = useState<StartupPlayback | null>(null);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [active, setActive] = useState(() => AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [laidOut, setLaidOut] = useState(false);
  const [presented, setPresented] = useState(false);

  const freezeFrames = useCallback(() => {
    if (framesFrozen.current) return;
    framesFrozen.current = true;
    setReadyFrames(loadedFrameIndices(frameStates.current));
  }, []);

  const settleFrame = useCallback((index: number, result: FrameLoadState) => {
    if (framesFrozen.current || frameStates.current[index] !== 'pending') return;
    frameStates.current[index] = result;
    if (result === 'failed') console.warn(`[startup] Animation frame ${index} could not be loaded; skipping it.`);
    if (frameStates.current.every(state => state !== 'pending')) freezeFrames();
  }, [freezeFrames]);

  useEffect(() => {
    if (readyFrames !== null) return;
    const timer = setTimeout(() => {
      console.warn('[startup] Animation preparation timed out; using the frames that loaded.');
      freezeFrames();
    }, STARTUP_ASSET_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [readyFrames, freezeFrames]);

  useEffect(() => {
    const controller = new AbortController();
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    void settleStartupTask(() => AccessibilityInfo.isReduceMotionEnabled(), 1_000, controller.signal)
      .then(result => {
        if (controller.signal.aborted || result.status === 'cancelled') return;
        // A live settings-change event takes precedence over the initial query.
        setReduceMotion(previous => previous ?? (result.status === 'ready' ? result.value : false));
      });
    const state = AppState.addEventListener('change', next => setActive(next === 'active'));
    return () => { controller.abort(); motion.remove(); state.remove(); };
  }, []);

  useEffect(() => {
    if (readyFrames !== null && reduceMotion !== null) {
      const frame = requestAnimationFrame(() => setPlayback(previous => previous ?? createStartupPlayback(readyFrames, reduceMotion)));
      return () => cancelAnimationFrame(frame);
    }
  }, [readyFrames, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      const frame = requestAnimationFrame(() => setPlayback(previous => previous && skipToStartupFinalFrame(previous)));
      return () => cancelAnimationFrame(frame);
    }
  }, [reduceMotion]);

  useEffect(() => {
    if (!laidOut || playback === null || presented || !active) return;
    let cancelled = false;
    // Commit the loaded image layer before releasing the OS launch screen.
    const frame = requestAnimationFrame(() => {
      void hideNativeSplash().then(() => { if (!cancelled) setPresented(true); });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [laidOut, playback, presented, active]);

  useEffect(() => {
    if (!presented || !active || playback === null || playback.finished) return;
    const isLast = playback.position === playback.frames.length - 1;
    const timer = setTimeout(() => {
      setPlayback(previous => previous && advanceStartupPlayback(previous));
    }, isLast ? STARTUP_FINAL_FRAME_DURATION_MS : STARTUP_FRAME_DURATION_MS);
    // Going into the background pauses here; returning resumes the same frame.
    return () => clearTimeout(timer);
  }, [presented, active, playback]);

  useEffect(() => {
    if (!presented || notified.current || !shouldDismissStartup(appReady, playback?.finished ?? false, active)) return;
    notified.current = true;
    onComplete();
  }, [presented, appReady, playback?.finished, active, onComplete]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    if (w > 0 && h > 0) setLaidOut(true);
  }, []);
  const visibleFrame = playback === null
    ? (reduceMotion ? startupFrames.length - 1 : 0)
    : currentStartupFrame(playback);

  return <View
    testID="startup-animation"
    style={styles.overlay}
    onLayout={onLayout}
    accessible
    accessibilityRole="progressbar"
    accessibilityLabel="Oni is loading"
    accessibilityState={{ busy: true }}
    accessibilityViewIsModal
  >
    <StatusBar hidden style="light" animated={false} />
    <View style={{ width: artworkWidth, height: artworkWidth / STARTUP_FRAME_ASPECT_RATIO }}
      pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {visibleFrame === null && <View testID="startup-artwork-fallback" style={styles.fallback}>
        <Image source={assets.logo} style={styles.fallbackLogo} resizeMode="contain" accessible={false} fadeDuration={0} />
        <Text style={styles.fallbackTitle}>Oni</Text>
      </View>}
      {startupFrames.map((source, index) => {
        // Keep decoded image layers mounted during playback; release the others
        // once the final frame is held. No source swapping or cross-fade flashes.
        if (playback?.finished && index !== visibleFrame) return null;
        return <Image
          key={index}
          testID={`startup-frame-${index}`}
          source={source}
          resizeMode="contain"
          resizeMethod="resize"
          fadeDuration={0}
          accessible={false}
          style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', opacity: index === visibleFrame ? 1 : 0 }]}
          onLoad={() => settleFrame(index, 'loaded')}
          onError={() => settleFrame(index, 'failed')}
        />;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill, zIndex: 1000, backgroundColor: STARTUP_BACKGROUND,
    alignItems: 'center', justifyContent: 'center',
  },
  fallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  fallbackLogo: { width: 100, height: 120 },
  fallbackTitle: { color: '#FFFFFF', fontSize: 22, marginTop: 12 },
});
