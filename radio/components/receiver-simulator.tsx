"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReceiverManifest } from "../receiver/manifest";
import {
  addExcludedProgramId,
  isAutoplayBlocked,
  resolvePlaybackStartOffsetMs,
  type ReceiverStatus,
} from "../receiver/runtime";
import { findCaptionAtTime } from "../receiver/captions";

type TuneResponse =
  | { result: "no_signal" }
  | { result: "signal"; manifest: ReceiverManifest };

type ReplenishResponse =
  | { result: "inventory_available"; readyProgramIds: string[] }
  | { result: "replenished"; programId: string };

type PendingReplenishment = {
  playingProgramId: string | null;
  promise: Promise<ReplenishResponse>;
};

type PrefetchedProgram = {
  audioUrl: string;
  byteLength: number;
  manifest: ReceiverManifest;
};

const maximumPrefetchedAudioBytes = 12 * 1024 * 1024;
const receiverExcludedProgramLimit = 2;

const statusLabels: Record<ReceiverStatus, string> = {
  idle: "等待调台",
  no_signal: "没有可用信号",
  tuning: "正在调台",
  buffering: "正在载入音频",
  playing: "正在播放",
  ended: "节目已结束",
  error: "播放异常",
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function createAbortError() {
  return new DOMException("调台请求已取消。", "AbortError");
}

function waitForAudioCanPlay(audio: HTMLAudioElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("音频无法载入或签名地址已失效。"));
    };
    const aborted = () => {
      cleanup();
      reject(createAbortError());
    };

    if (signal.aborted) {
      aborted();
      return;
    }
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      ready();
      return;
    }
    audio.addEventListener("canplay", ready, { once: true });
    audio.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
  });
}

function startTuningNoise() {
  if (typeof window === "undefined" || !window.AudioContext) {
    return () => undefined;
  }

  const context = new AudioContext();
  const buffer = context.createBuffer(
    1,
    Math.round(context.sampleRate * 0.24),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.loop = true;
  gain.gain.setValueAtTime(0.012, context.currentTime);
  gain.gain.linearRampToValueAtTime(0.025, context.currentTime + 0.06);
  source.connect(gain).connect(context.destination);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      source.stop();
    } catch {
      // 已停止的静电音无需额外处理。
    }
    source.disconnect();
    gain.disconnect();
    void context.close();
  };
  void context.resume().catch(() => undefined);
  source.start();
  return stop;
}

export function ReceiverSimulator() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioSourceRef = useRef<string | null>(null);
  const manifestRef = useRef<ReceiverManifest | null>(null);
  const sequenceRef = useRef(0);
  const tuneAbortRef = useRef<AbortController | null>(null);
  const noiseStopRef = useRef<(() => void) | null>(null);
  const excludedProgramIdsRef = useRef<string[]>([]);
  const completingRef = useRef(false);
  const replenishmentRef = useRef<PendingReplenishment | null>(null);
  const replenishmentErrorRef = useRef<{
    message: string;
    playingProgramId: string | null;
  } | null>(null);
  const prefetchedProgramRef = useRef<PrefetchedProgram | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const prefetchPromiseRef = useRef<Promise<void> | null>(null);
  const [manifest, setManifest] = useState<ReceiverManifest | null>(null);
  const [status, setStatus] = useState<ReceiverStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [manualPlaybackRequired, setManualPlaybackRequired] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const currentCaption = manifest
    ? findCaptionAtTime(manifest.captions, playbackSeconds * 1_000)
    : null;

  function stopCurrentAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (audioSourceRef.current?.startsWith("blob:"))
      URL.revokeObjectURL(audioSourceRef.current);
    audioSourceRef.current = null;
    setPlaybackSeconds(0);
  }

  function rememberCurrentProgram() {
    const current = manifestRef.current;
    if (!current) return;
    excludedProgramIdsRef.current = addExcludedProgramId(
      excludedProgramIdsRef.current,
      current.programId,
      receiverExcludedProgramLimit,
    );
  }

  function clearPrefetchedProgram() {
    const prefetched = prefetchedProgramRef.current;
    if (!prefetched) return;
    prefetchedProgramRef.current = null;
    URL.revokeObjectURL(prefetched.audioUrl);
  }

  function takePrefetchedProgram() {
    const prefetched = prefetchedProgramRef.current;
    if (!prefetched) return null;
    prefetchedProgramRef.current = null;
    return prefetched;
  }

  function tuneExclusions() {
    let ids = excludedProgramIdsRef.current;
    const prefetched = prefetchedProgramRef.current;
    if (prefetched)
      ids = addExcludedProgramId(
        ids,
        prefetched.manifest.programId,
        receiverExcludedProgramLimit,
      );
    return ids;
  }

  function isLatest(sequence: number) {
    return sequenceRef.current === sequence;
  }

  function stopTuningNoise(stop?: () => void) {
    const currentStop = stop ?? noiseStopRef.current;
    if (!currentStop) return;
    if (noiseStopRef.current === currentStop) noiseStopRef.current = null;
    currentStop();
  }

  function replenishInventory(playingProgramId: string | null) {
    const pending = replenishmentRef.current;
    if (pending) return pending.promise;

    const request = fetch("/api/receiver/replenish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playingProgramId }),
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as ReplenishResponse & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(payload.error ?? "无法补充下一节目库存。");
        replenishmentErrorRef.current = null;
        return payload;
      })
      .catch((caughtError) => {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "无法补充下一节目库存。";
        replenishmentErrorRef.current = { message, playingProgramId };
        throw caughtError;
    });
    replenishmentRef.current = { playingProgramId, promise: request };
    void request.then(
      () => {
        if (replenishmentRef.current?.promise === request)
          replenishmentRef.current = null;
      },
      () => {
        if (replenishmentRef.current?.promise === request)
          replenishmentRef.current = null;
      },
    );
    return request;
  }

  function prefetchNextProgram(playingProgramId: string) {
    if (prefetchAbortRef.current || prefetchedProgramRef.current)
      return Promise.resolve();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;

    const requestManifest = async () => {
      const response = await fetch("/api/receiver/tune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          excludeProgramIds: addExcludedProgramId(
            tuneExclusions(),
            playingProgramId,
            receiverExcludedProgramLimit,
          ),
        }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as TuneResponse & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "无法预加载下一节目。");
      return payload;
    };

    const operation = (async () => {
      try {
        let payload = await requestManifest();
        if (payload.result === "no_signal") {
          await replenishInventory(playingProgramId);
          if (controller.signal.aborted) return;
          payload = await requestManifest();
        }
        if (payload.result === "no_signal") return;

        const response = await fetch(payload.manifest.audioUrl, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("下一节目的音频预加载失败。");
        const audio = await response.blob();
        if (audio.size === 0 || audio.size > maximumPrefetchedAudioBytes)
          throw new Error("下一节目的音频大小不适合预加载。");
        if (controller.signal.aborted) return;
        clearPrefetchedProgram();
        prefetchedProgramRef.current = {
          audioUrl: URL.createObjectURL(audio),
          byteLength: audio.size,
          manifest: payload.manifest,
        };
      } catch (error) {
        if (!controller.signal.aborted)
          console.warn("下一节目的预加载未完成。", error);
      } finally {
        if (prefetchAbortRef.current === controller) prefetchAbortRef.current = null;
      }
    })();
    prefetchPromiseRef.current = operation;
    void operation.then(() => {
      if (prefetchPromiseRef.current === operation) prefetchPromiseRef.current = null;
    });
    return operation;
  }

  async function tune(
    options: {
      playFromStart?: boolean;
      prefetched?: PrefetchedProgram | null;
      replenishWhenEmpty?: boolean;
    } = {},
  ) {
    const playFromStart = options.playFromStart ?? false;
    const replenishWhenEmpty = options.replenishWhenEmpty ?? true;
    const prefetched = options.prefetched ?? takePrefetchedProgram();
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    tuneAbortRef.current?.abort();
    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = null;
    stopTuningNoise();
    rememberCurrentProgram();
    manifestRef.current = null;
    setManifest(null);
    stopCurrentAudio();
    setError(null);
    setManualPlaybackRequired(false);
    setStatus("tuning");

    const controller = new AbortController();
    tuneAbortRef.current = controller;
    const stopNoise = startTuningNoise();
    noiseStopRef.current = stopNoise;
    let audioReadyToPlay = false;

    try {
      setStatus("buffering");
      let nextManifest: ReceiverManifest;
      let audioUrl: string;
      if (prefetched) {
        nextManifest = {
          ...prefetched.manifest,
          startOffsetMs: resolvePlaybackStartOffsetMs(
            prefetched.manifest.startOffsetMs,
            playFromStart,
          ),
        };
        audioUrl = prefetched.audioUrl;
      } else {
        const response = await fetch("/api/receiver/tune", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            excludeProgramIds: tuneExclusions(),
          }),
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as TuneResponse & {
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "调台请求失败。");
        if (!isLatest(sequence)) return;
        if (payload.result === "no_signal") {
        if (replenishWhenEmpty) {
          setStatus("buffering");
          try {
            await replenishInventory(null);
          } catch (caughtError) {
            if (!isLatest(sequence)) return;
            stopTuningNoise(stopNoise);
            setStatus("no_signal");
            setError(
              caughtError instanceof Error
                ? caughtError.message
                : "没有可播节目，且自动补充失败。",
            );
            return;
          }
          if (!isLatest(sequence)) return;
          await tune({ replenishWhenEmpty: false });
          return;
        }
        stopTuningNoise(stopNoise);
        setStatus("no_signal");
        return;
        }
        nextManifest = {
          ...payload.manifest,
          startOffsetMs: resolvePlaybackStartOffsetMs(
            payload.manifest.startOffsetMs,
            playFromStart,
          ),
        };
        audioUrl = nextManifest.audioUrl;
      }
      manifestRef.current = nextManifest;
      setManifest(nextManifest);
      const audio = audioRef.current;
      if (!audio) throw new Error("播放器尚未准备好。");

      const playable = waitForAudioCanPlay(audio, controller.signal);
      audioSourceRef.current = audioUrl;
      audio.src = audioUrl;
      audio.load();
      await playable;
      if (!isLatest(sequence)) return;

      const durationSeconds = audio.duration || nextManifest.durationMs / 1000;
      audio.currentTime = Math.min(
        nextManifest.startOffsetMs / 1000,
        Math.max(0, durationSeconds - 0.01),
      );
      setPlaybackSeconds(audio.currentTime);
      audioReadyToPlay = true;
      await audio.play();
      if (!isLatest(sequence)) {
        if (audio.currentSrc === audioUrl) audio.pause();
        return;
      }
      stopTuningNoise(stopNoise);
      setPlaybackSeconds(audio.currentTime);
      setStatus("playing");
      void prefetchNextProgram(nextManifest.programId);
    } catch (caughtError) {
      if (!isLatest(sequence) || controller.signal.aborted) return;
      if (audioReadyToPlay) {
        setStatus("buffering");
        setManualPlaybackRequired(true);
        setError(
          isAutoplayBlocked(caughtError)
            ? "浏览器阻止自动播放，请点击“开始播放”。"
            : "音频已就绪，但自动播放被打断，请点击“开始播放”。",
        );
        return;
      }
      stopTuningNoise(stopNoise);
      setStatus("error");
      setError(
        caughtError instanceof Error ? caughtError.message : "接收机发生未知错误。",
      );
    }
  }

  async function startLoadedAudio() {
    const audio = audioRef.current;
    const current = manifestRef.current;
    const sequence = sequenceRef.current;
    if (!audio || !current) return;
    try {
      await audio.play();
      if (!isLatest(sequence) || manifestRef.current?.programId !== current.programId) {
        return;
      }
      stopTuningNoise();
      setManualPlaybackRequired(false);
      setError(null);
      setPlaybackSeconds(audio.currentTime);
      setStatus("playing");
    } catch (caughtError) {
      if (!isLatest(sequence) || manifestRef.current?.programId !== current.programId) {
        return;
      }
      stopTuningNoise();
      setStatus("error");
      setError(
        isAutoplayBlocked(caughtError)
          ? "浏览器仍阻止播放，请使用下方播放器控制条开始播放。"
          : "播放器启动被打断，请重新调台后再试。",
      );
    }
  }

  async function completeCurrentProgram() {
    const current = manifestRef.current;
    if (!current || completingRef.current) return;
    const sequence = sequenceRef.current;
    completingRef.current = true;
    setStatus("ended");
    setPlaybackSeconds(current.durationMs / 1000);
    excludedProgramIdsRef.current = addExcludedProgramId(
      excludedProgramIdsRef.current,
      current.programId,
      receiverExcludedProgramLimit,
    );

    try {
      const response = await fetch(
        `/api/receiver/programs/${current.programId}/completed`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "无法同步节目播放完成状态。");
      if (!isLatest(sequence) || manifestRef.current?.programId !== current.programId)
        return;

      const prefetch = prefetchPromiseRef.current;
      if (prefetch) await prefetch;
      if (!isLatest(sequence) || manifestRef.current?.programId !== current.programId)
        return;

      const pending = replenishmentRef.current;
      if (pending?.playingProgramId === current.programId) {
        try {
          await pending.promise;
        } catch {
          // 失败详情会由同一轮补充请求保存，避免结束时再次产生付费请求。
        }
      }
      if (!isLatest(sequence) || manifestRef.current?.programId !== current.programId)
        return;
      const replenishmentError = replenishmentErrorRef.current;
      if (replenishmentError?.playingProgramId === current.programId) {
        setStatus("no_signal");
        setError(`节目已结束，但下一节目补充失败：${replenishmentError.message}`);
        return;
      }
      void tune({ playFromStart: true, replenishWhenEmpty: false });
    } catch (caughtError) {
      if (manifestRef.current?.programId === current.programId) {
        setStatus("error");
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "节目播放结束后同步失败。",
        );
      }
    } finally {
      completingRef.current = false;
    }
  }

  useEffect(() => {
    return () => {
      sequenceRef.current += 1;
      tuneAbortRef.current?.abort();
      noiseStopRef.current?.();
      prefetchAbortRef.current?.abort();
      clearPrefetchedProgram();
      stopCurrentAudio();
    };
  }, []);

  return (
    <main className="workbench receiver-workbench">
      <header className="page-header receiver-header">
        <div>
          <h1>Web Receiver Simulator</h1>
          <p>使用未来 ESP32 将消费的接收机协议验证调台与播放行为。</p>
        </div>
        <Link className="receiver-back-link" href="/">
          返回管理后台
        </Link>
      </header>

      <section className="panel receiver-panel" aria-labelledby="receiver-heading">
        <div className="panel-heading">
          <div>
            <h2 id="receiver-heading">接收机</h2>
            <p aria-live="polite">{statusLabels[status]}</p>
          </div>
          <span className={`receiver-status receiver-status-${status}`}>
            {statusLabels[status]}
          </span>
        </div>

        <div className="receiver-body">
          <div className="receiver-now-playing">
            <p className="receiver-label">当前信号</p>
            <h3>{manifest?.title ?? "尚未调入节目"}</h3>
            <p>
              {manifest
                ? `${manifest.format} · 从 ${formatTime(manifest.startOffsetMs / 1000)} 切入`
                : "点击下方按钮开始搜索可播节目。"}
            </p>
          </div>

          <div className="receiver-caption" aria-live="polite">
            <p className="receiver-label">中文字幕</p>
            <p>
              {currentCaption
                ? `${currentCaption.speaker}：${currentCaption.text}`
                : ""}
            </p>
          </div>

          <dl className="receiver-metrics">
            <div>
              <dt>开始偏移</dt>
              <dd>{manifest ? formatTime(manifest.startOffsetMs / 1000) : "--:--"}</dd>
            </div>
            <div>
              <dt>播放进度</dt>
              <dd>
                {formatTime(playbackSeconds)} / {formatTime(manifest?.durationMs ? manifest.durationMs / 1000 : Number.NaN)}
              </dd>
            </div>
          </dl>

          <audio
            aria-label="接收机音频播放器"
            controls
            onEnded={() => void completeCurrentProgram()}
            onError={(event) => {
              const current = manifestRef.current;
              if (!current || event.currentTarget.currentSrc !== audioSourceRef.current)
                return;
              setStatus("error");
              setError("音频播放失败，请重新调台获取新的信号。");
            }}
            onPlay={(event) => {
              const current = manifestRef.current;
              if (!current || event.currentTarget.currentSrc !== audioSourceRef.current)
                return;
              stopTuningNoise();
              setManualPlaybackRequired(false);
              setError(null);
              setStatus("playing");
              void prefetchNextProgram(current.programId);
            }}
            onTimeUpdate={(event) => setPlaybackSeconds(event.currentTarget.currentTime)}
            ref={audioRef}
          />

          {error && (
            <p className="receiver-error" role="alert">
              {error}
            </p>
          )}

          {manualPlaybackRequired && (
            <button
              className="text-button receiver-start-button"
              onClick={() => void startLoadedAudio()}
              type="button"
            >
              开始播放
            </button>
          )}

          <button
            className="primary-button receiver-tune-button"
            onClick={() => void tune()}
            type="button"
          >
            {status === "tuning" || status === "buffering"
              ? "重新调台"
              : "调台 / 下一个信号"}
          </button>
          <p className="receiver-help">
            中途调台只停止当前播放；只有音频真正结束才会下线节目。
          </p>
        </div>
      </section>
    </main>
  );
}
