"use client";

import { useEffect, useRef, useState } from "react";
import {
  programFormats,
  type BroadcastScript,
  type ProgramFormat,
  type RadioProgram,
} from "../program/types";
import type { RenderMode } from "../renderer/render";
import {
  alienDialectOptions,
  defaultAlienDialect,
  isAlienDialect,
  type AlienDialect,
} from "../renderer/alien-language";
import {
  deliveryProfileIds,
  getDefaultDeliveryProfileId,
  getDeliveryProfile,
  type DeliveryProfileId,
} from "../renderer/delivery";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "请求失败。");
  return body;
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatDuration(durationMs: number | null) {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return "—";
  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

type InventoryBatchResult =
  | {
      cleanupWarning?: string | null;
      id: string;
      program?: RadioProgram;
      success: true;
    }
  | { error: string; id: string; success: false };

function asBroadcastScript(content: RadioProgram["content"]): BroadcastScript | null {
  if (
    typeof content.title !== "string" ||
    (content.format !== "news" && content.format !== "chat") ||
    typeof content.language !== "string" ||
    content.fictional !== true ||
    !Array.isArray(content.segments) ||
    !Array.isArray(content.sources)
  )
    return null;
  const segments = content.segments.filter(
    (segment): segment is { speaker: string; text: string } =>
      typeof segment === "object" &&
      segment !== null &&
      typeof (segment as { speaker?: unknown }).speaker === "string" &&
      typeof (segment as { text?: unknown }).text === "string",
  );
  return segments.length === content.segments.length
    ? {
        title: content.title,
        format: content.format,
        language: content.language,
        fictional: true,
        segments,
        sources: content.sources.filter(
          (source): source is string => typeof source === "string",
        ),
      }
    : null;
}

function getSavedDeliverySettings(recipe: RadioProgram["recipe"]): {
  alienDialect: AlienDialect | null;
  deliveryProfile: DeliveryProfileId | null;
  renderMode: RenderMode | null;
  speed: number | null;
} {
  const renderMode: RenderMode | null =
    recipe.render_mode === "normal" || recipe.render_mode === "alien"
      ? recipe.render_mode
      : null;
  const alienDialect = isAlienDialect(recipe.alien_dialect)
    ? recipe.alien_dialect
    : null;
  const deliveryProfile =
    typeof recipe.delivery_profile === "string" &&
    deliveryProfileIds.includes(recipe.delivery_profile as DeliveryProfileId)
      ? (recipe.delivery_profile as DeliveryProfileId)
      : null;
  const speed =
    typeof recipe.tts_speed === "number" && Number.isFinite(recipe.tts_speed)
      ? recipe.tts_speed
      : null;
  return { alienDialect, deliveryProfile, renderMode, speed };
}

function getRenderModeLabel(renderMode: RenderMode) {
  return renderMode === "alien" ? "外星伪语播报" : "中文原文播报";
}

function getAlienDialectLabel(dialect: AlienDialect) {
  return (
    alienDialectOptions.find((option) => option.value === dialect)?.label ??
    dialect
  );
}

export function RadioManagement() {
  const [format, setFormat] = useState<ProgramFormat>("news");
  const [language, setLanguage] = useState("中文");
  const [style, setStyle] = useState("冷静、略带未知感");
  const [topic, setTopic] = useState("");
  const [programs, setPrograms] = useState<RadioProgram[]>([]);
  const [selected, setSelected] = useState<RadioProgram | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [synthesizingProgramId, setSynthesizingProgramId] = useState<
    string | null
  >(null);
  const [deliveryProfile, setDeliveryProfile] =
    useState<DeliveryProfileId | null>(null);
  const [alienDialect, setAlienDialect] =
    useState<AlienDialect>(defaultAlienDialect);
  const [renderMode, setRenderMode] = useState<RenderMode>("normal");
  const [audioRefreshAttempted, setAudioRefreshAttempted] = useState(false);
  const [checkedProgramIds, setCheckedProgramIds] = useState<string[]>([]);
  const selectedProgramIdRef = useRef<string | null>(null);
  const selectedScript = selected ? asBroadcastScript(selected.content) : null;
  const savedDeliverySettings = selected
    ? getSavedDeliverySettings(selected.recipe)
    : null;
  const effectiveDeliveryProfile =
    deliveryProfile ??
    getDefaultDeliveryProfileId(selected?.format ?? format);
  const canSynthesizeAudio = Boolean(
    selectedScript &&
      (selected?.status === "queued" ||
        selected?.status === "failed" ||
        selected?.status === "ready"),
  );
  const isSynthesisInProgress = synthesizingProgramId !== null;
  const isSelectedProgramSynthesizing =
    selected?.id === synthesizingProgramId;
  const checkedPrograms = programs.filter((program) =>
    checkedProgramIds.includes(program.id),
  );
  const checkedReadyPrograms = checkedPrograms.filter(
    (program) => program.status === "ready",
  );
  const selectedActivePrograms = checkedReadyPrograms.filter(
    (program) => !program.retired_at,
  );
  const selectedRetiredPrograms = checkedReadyPrograms.filter((program) =>
    Boolean(program.retired_at),
  );
  const allProgramsChecked =
    programs.length > 0 &&
    programs.every((program) => checkedProgramIds.includes(program.id));

  async function loadPrograms() {
    try {
      setLoading(true);
      const nextPrograms = (
        await request<{ programs: RadioProgram[] }>("/api/programs")
      ).programs;
      setPrograms(nextPrograms);
      setCheckedProgramIds((ids) =>
        ids.filter((id) =>
          nextPrograms.some((program) => program.id === id),
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取节目列表。");
    } finally {
      setLoading(false);
    }
  }

  async function selectProgram(id: string) {
    selectedProgramIdRef.current = id;
    try {
      const program = (
        await request<{ program: RadioProgram }>(`/api/programs/${id}`)
      ).program;
      if (selectedProgramIdRef.current !== id) return;
      setSelected(program);
      const savedSettings = getSavedDeliverySettings(program.recipe);
      setAlienDialect(savedSettings.alienDialect ?? defaultAlienDialect);
      setDeliveryProfile(savedSettings.deliveryProfile);
      setRenderMode(savedSettings.renderMode ?? "normal");
      setAudioUrl(null);
      setAudioRefreshAttempted(false);
      if (program.audio_path) await refreshAudioUrl(id);
      else setAudioLoading(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取节目详情。");
    }
  }

  function closeProgramDetail() {
    selectedProgramIdRef.current = null;
    setSelected(null);
    setAudioUrl(null);
    setAudioLoading(false);
    setAudioRefreshAttempted(false);
  }

  async function refreshAudioUrl(id: string) {
    try {
      setAudioLoading(true);
      const { signedUrl } = await request<{ signedUrl: string }>(
        `/api/programs/${id}/audio-url`,
      );
      if (selectedProgramIdRef.current !== id) return;
      setAudioUrl(signedUrl);
    } catch (error) {
      if (selectedProgramIdRef.current === id) {
        setAudioUrl(null);
        setMessage(
          error instanceof Error ? error.message : "无法刷新音频试听地址。",
        );
      }
    } finally {
      if (selectedProgramIdRef.current === id) setAudioLoading(false);
    }
  }

  function handleAudioError() {
    if (!selected) return;
    if (audioRefreshAttempted) {
      setAudioUrl(null);
      setMessage("音频试听失败，已自动刷新一次地址，请稍后重新选择节目再试。");
      return;
    }
    setAudioRefreshAttempted(true);
    setMessage("音频播放失败，正在自动刷新一次试听地址…");
    void refreshAudioUrl(selected.id);
  }

  async function generateScript() {
    try {
      setGenerating(true);
      setMessage(null);
      const response = await fetch("/api/programs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, language, style, topic }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        program?: RadioProgram;
      };
      if (body.program) {
        selectedProgramIdRef.current = body.program.id;
        setSelected(body.program);
        setAlienDialect(defaultAlienDialect);
        setDeliveryProfile(null);
        setRenderMode("normal");
        setAudioUrl(null);
        setAudioLoading(false);
        setAudioRefreshAttempted(false);
        await loadPrograms();
      }
      if (!response.ok)
        throw new Error(body.error ?? "无法生成稿件。");
      setMessage("稿件已保存，等待后续语音合成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法生成稿件。");
    } finally {
      setGenerating(false);
    }
  }

  async function synthesizeSpeech(requestedRenderMode: RenderMode) {
    if (!selected) return;
    const synthesisProgramId = selected.id;
    try {
      setSynthesizingProgramId(synthesisProgramId);
      setMessage(null);
      const response = await fetch(`/api/programs/${synthesisProgramId}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryProfile: effectiveDeliveryProfile,
          alienDialect:
            requestedRenderMode === "alien" ? alienDialect : undefined,
          renderMode: requestedRenderMode,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        cleanupWarning?: string | null;
        error?: string;
        program?: RadioProgram;
      };
      if (body.program) {
        const savedSettings = getSavedDeliverySettings(body.program.recipe);
        if (selectedProgramIdRef.current === synthesisProgramId)
          await selectProgram(body.program.id);
        await loadPrograms();
        if (
          response.ok &&
          savedSettings.renderMode !== requestedRenderMode
        )
          throw new Error("语音已保存，但保存的播报模式与本次请求不一致。");
        if (
          response.ok &&
          requestedRenderMode === "alien" &&
          savedSettings.alienDialect !== alienDialect
        )
          throw new Error("语音已保存，但保存的外星方言与本次请求不一致。");
      }
      if (!response.ok)
        throw new Error(body.error ?? "无法合成语音。");
      setMessage(
        body.cleanupWarning ??
          `已按${getRenderModeLabel(requestedRenderMode)}合成并保存，可开始试听。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法合成语音。");
    } finally {
      setSynthesizingProgramId((current) =>
        current === synthesisProgramId ? null : current,
      );
    }
  }

  async function changeInventory(id: string, action: "retire" | "restore") {
    try {
      setSaving(true);
      const { program } = await request<{ program: RadioProgram }>(
        `/api/programs/${id}/${action}`,
        { method: "POST" },
      );
      if (selected?.id === id) setSelected(program);
      await loadPrograms();
      setMessage(
        action === "retire" ? "节目已下线。" : "节目已恢复到播出池。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法更新节目播出状态。");
    } finally {
      setSaving(false);
    }
  }

  function setProgramChecked(id: string, checked: boolean) {
    setCheckedProgramIds((ids) =>
      checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id),
    );
  }

  function toggleAllPrograms() {
    setCheckedProgramIds(
      allProgramsChecked ? [] : programs.map((program) => program.id),
    );
  }

  async function changeInventoryBatch(action: "retire" | "restore") {
    const targetPrograms =
      action === "retire" ? selectedActivePrograms : selectedRetiredPrograms;
    if (targetPrograms.length === 0) return;

    try {
      setSaving(true);
      setMessage(null);
      const { results } = await request<{ results: InventoryBatchResult[] }>(
        "/api/programs/inventory",
        {
          body: JSON.stringify({
            action,
            programIds: targetPrograms.map((program) => program.id),
          }),
          method: "POST",
        },
      );
      const successfulResults = results.filter(
        (result): result is Extract<InventoryBatchResult, { success: true }> =>
          result.success,
      );
      const successfulIds = successfulResults.map((result) => result.id);
      const selectedResult = successfulResults.find(
        (result) => result.id === selected?.id,
      );
      if (selectedResult?.program) setSelected(selectedResult.program);
      setCheckedProgramIds((ids) =>
        ids.filter((id) => !successfulIds.includes(id)),
      );
      await loadPrograms();
      const failedCount = results.length - successfulResults.length;
      const actionLabel = action === "retire" ? "下线" : "恢复";
      setMessage(
        failedCount > 0
          ? `已${actionLabel} ${successfulResults.length} 条节目，${failedCount} 条未能处理。`
          : `已${actionLabel} ${successfulResults.length} 条节目。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法批量更新节目播出状态。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProgramsBatch() {
    if (checkedPrograms.length === 0) return;
    if (
      !window.confirm(
        `删除所选 ${checkedPrograms.length} 条节目及其音频文件？此操作不可恢复。`,
      )
    )
      return;

    try {
      setSaving(true);
      setMessage(null);
      const { results } = await request<{ results: InventoryBatchResult[] }>(
        "/api/programs/inventory",
        {
          body: JSON.stringify({
            action: "delete",
            programIds: checkedPrograms.map((program) => program.id),
          }),
          method: "POST",
        },
      );
      const successfulResults = results.filter(
        (result): result is Extract<InventoryBatchResult, { success: true }> =>
          result.success,
      );
      const successfulIds = successfulResults.map((result) => result.id);
      if (selected && successfulIds.includes(selected.id)) {
        selectedProgramIdRef.current = null;
        setSelected(null);
        setAudioUrl(null);
        setAudioLoading(false);
      }
      setCheckedProgramIds((ids) =>
        ids.filter((id) => !successfulIds.includes(id)),
      );
      await loadPrograms();
      const failedCount = results.length - successfulResults.length;
      const cleanupWarningCount = successfulResults.filter(
        (result) => result.cleanupWarning,
      ).length;
      const resultMessage =
        failedCount > 0
          ? `已删除 ${successfulResults.length} 条节目，${failedCount} 条未能删除。`
          : `已删除 ${successfulResults.length} 条节目。`;
      setMessage(
        cleanupWarningCount > 0
          ? `${resultMessage}${cleanupWarningCount} 个音频对象未能清理。`
          : resultMessage,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法批量删除节目。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProgram(id: string) {
    if (!window.confirm("删除节目及其音频文件？此操作不可恢复。")) return;
    try {
      setSaving(true);
      const { cleanupWarning } = await request<{
        cleanupWarning: string | null;
      }>(`/api/programs/${id}`, { method: "DELETE" });
      if (selected?.id === id) {
        selectedProgramIdRef.current = null;
        setSelected(null);
        setAudioUrl(null);
        setAudioLoading(false);
      }
      await loadPrograms();
      if (cleanupWarning) setMessage(cleanupWarning);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法删除节目。");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    let active = true;
    void request<{ programs: RadioProgram[] }>("/api/programs")
      .then(({ programs: nextPrograms }) => {
        if (active) setPrograms(nextPrograms);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "无法读取节目列表。",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      selectedProgramIdRef.current = null;
      setSelected(null);
      setAudioUrl(null);
      setAudioLoading(false);
      setAudioRefreshAttempted(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  return (
    <main className="workbench">
      <header className="page-header">
        <div>
          <h1>宇宙电台</h1>
          <p>节目内容管理与调试后台</p>
        </div>
      </header>
      <section className="panel create-panel" aria-labelledby="compose-heading">
        <div className="panel-heading">
          <div>
            <h2 id="compose-heading">新建节目</h2>
            <p>设置节目参数后生成稿件；不会自动调用文本或语音服务。</p>
          </div>
        </div>
        <div className="form-grid" role="group" aria-label="节目参数">
          <fieldset>
            <legend>节目形式</legend>
            <div className="format-options">
              {programFormats.map((option) => (
                <label className="format-option" key={option.value}>
                  <input
                    checked={format === option.value}
                    name="format"
                    onChange={() => setFormat(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            <span>语言</span>
            <input
              onChange={(event) => setLanguage(event.target.value)}
              value={language}
            />
          </label>
          <label>
            <span>风格</span>
            <input
              onChange={(event) => setStyle(event.target.value)}
              value={style}
            />
          </label>
          <label>
            <span>主题（可选）</span>
            <input
              onChange={(event) => setTopic(event.target.value)}
              placeholder="留空时由模型自行决定"
              value={topic}
            />
          </label>
        </div>
        <button
          className="primary-button"
          disabled={generating}
          onClick={() => void generateScript()}
          type="button"
        >
          {generating ? "正在生成稿件…" : "生成稿件"}
        </button>
      </section>
      <div className="management-grid">
        <section
          className="panel program-list"
          aria-labelledby="library-heading"
        >
          <div className="panel-heading">
            <div>
              <h2 id="library-heading">节目列表</h2>
              <p>真实节目数据保存在私有资源中。</p>
            </div>
            <div className="inventory-batch-actions">
              <span className="count">{programs.length} 个节目</span>
              {checkedPrograms.length > 0 && (
                <span className="inventory-batch-summary">
                  已选择 {checkedPrograms.length} 条
                </span>
              )}
              <button
                className="text-button"
                disabled={saving || selectedActivePrograms.length === 0}
                onClick={() => void changeInventoryBatch("retire")}
                type="button"
              >
                批量下线{selectedActivePrograms.length > 0 ? `（${selectedActivePrograms.length}）` : ""}
              </button>
              <button
                className="text-button"
                disabled={saving || selectedRetiredPrograms.length === 0}
                onClick={() => void changeInventoryBatch("restore")}
                type="button"
              >
                批量恢复{selectedRetiredPrograms.length > 0 ? `（${selectedRetiredPrograms.length}）` : ""}
              </button>
              <button
                className="text-button danger-button"
                disabled={saving || checkedPrograms.length === 0}
                onClick={() => void deleteProgramsBatch()}
                type="button"
              >
                批量删除{checkedPrograms.length > 0 ? `（${checkedPrograms.length}）` : ""}
              </button>
            </div>
          </div>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="selection-column" scope="col">
                    <input
                      aria-label="全选节目"
                      checked={allProgramsChecked}
                      disabled={loading || programs.length === 0 || saving}
                      onChange={toggleAllPrograms}
                      type="checkbox"
                    />
                  </th>
                  <th scope="col">节目</th>
                  <th scope="col">形式</th>
                  <th scope="col">状态</th>
                  <th scope="col">时长</th>
                  <th scope="col">创建时间</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr className="empty-row">
                    <td colSpan={7}>正在读取节目…</td>
                  </tr>
                )}
                {!loading && programs.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={7}>暂无节目。当前没有伪造的示例数据。</td>
                  </tr>
                )}
                {!loading &&
                  programs.map((program) => (
                    <tr
                      aria-label={`查看节目：${program.title || "未命名节目"}`}
                      className={`program-row${selected?.id === program.id ? " is-selected" : ""}`}
                      key={program.id}
                      onClick={() => void selectProgram(program.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void selectProgram(program.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <td className="selection-column">
                        <input
                          aria-label={`选择节目：${program.title || "未命名节目"}`}
                          checked={checkedProgramIds.includes(program.id)}
                          disabled={saving}
                          onChange={(event) =>
                            setProgramChecked(program.id, event.target.checked)
                          }
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          type="checkbox"
                        />
                      </td>
                      <td>{program.title || "未命名节目"}</td>
                      <td>{program.format}</td>
                      <td>
                        <span className={`status status-${program.status}`}>
                          {program.status}
                        </span>
                        <span className="inventory-status">
                          {program.status === "ready"
                            ? program.retired_at
                              ? "已下线"
                              : "可播"
                            : "不可播"}
                        </span>
                      </td>
                      <td>{formatDuration(program.duration_ms)}</td>
                      <td>
                        {dateFormatter.format(new Date(program.created_at))}
                      </td>
                      <td>
                        <div className="row-actions">
                          {program.status === "ready" && (
                            <button
                              className="text-button"
                              disabled={saving}
                              onClick={(event) => {
                                event.stopPropagation();
                                void changeInventory(
                                  program.id,
                                  program.retired_at ? "restore" : "retire",
                                );
                              }}
                              type="button"
                            >
                              {program.retired_at ? "恢复" : "下线"}
                            </button>
                          )}
                          <button
                            className="text-button danger-button"
                            disabled={saving}
                            onClick={(event) => {
                              event.stopPropagation();
                              void deleteProgram(program.id);
                            }}
                            type="button"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {selected && (
        <div
          className="detail-drawer-backdrop"
          onMouseDown={closeProgramDetail}
        >
          <aside
            aria-labelledby="detail-heading"
            aria-modal="true"
            className="panel detail-panel"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="panel-heading">
              <div>
                <h2 id="detail-heading">节目详情</h2>
                <p>{selected.title || "未命名节目"}</p>
              </div>
              <button
                aria-label="关闭节目详情"
                className="text-button drawer-close-button"
                onClick={closeProgramDetail}
                type="button"
              >
                关闭
              </button>
            </div>
          <div className="detail-section">
            <h3>状态</h3>
            <p>
              {!selected
                ? "尚未选择节目"
                : selected.status !== "ready"
                  ? `${selected.status} · 不可播`
                  : selected.retired_at
                    ? "ready · 已下线"
                    : "ready · 可播"}
            </p>
            {selected?.error && <p className="program-error">{selected.error}</p>}
          </div>
          <div className="detail-section">
            <h3>音频</h3>
            {audioLoading ? (
              <p>正在加载音频资源…</p>
            ) : audioUrl ? (
              <audio
                aria-label="节目音频播放器"
                controls
                onError={handleAudioError}
                src={audioUrl}
              />
            ) : (
              <p>尚无可试听的音频</p>
            )}
            {selected?.status === "ready" &&
              savedDeliverySettings?.renderMode && (
                <p className="audio-delivery-summary">
                  当前已保存：
                  {getRenderModeLabel(savedDeliverySettings.renderMode)}
                  {savedDeliverySettings.renderMode === "alien" &&
                  savedDeliverySettings.alienDialect
                    ? ` · ${getAlienDialectLabel(savedDeliverySettings.alienDialect)}`
                    : ""}
                  {selectedScript
                    ? ` · ${selectedScript.language} 稿件与字幕`
                    : ""}
                  {savedDeliverySettings.deliveryProfile
                    ? ` · ${getDeliveryProfile(savedDeliverySettings.deliveryProfile).label}`
                    : ""}
                  {savedDeliverySettings.speed
                    ? ` · ${savedDeliverySettings.speed}×`
                    : ""}
                </p>
              )}
          </div>
          {canSynthesizeAudio && (
            <div className="detail-section">
              <h3>
                {selected?.status === "ready" ? "重新生成音频" : "合成语音"}
              </h3>
              <div className="synthesis-controls">
                <p>
                  {selected?.status === "ready"
                    ? "将根据现有稿件重新构建音频；新音频成功保存后才会替换当前资源。"
                    : "将由 Renderer 按说话者自动分配内置中文音色。"}
                </p>
                <div
                  aria-label="语音语言模式"
                  className="synthesis-mode"
                  role="radiogroup"
                >
                  <span>语音语言模式</span>
                  <label>
                    <input
                      checked={renderMode === "normal"}
                      disabled={isSynthesisInProgress}
                      name="render-mode"
                      onChange={() => setRenderMode("normal")}
                      type="radio"
                      value="normal"
                    />
                    中文原文播报
                  </label>
                  <label>
                    <input
                      checked={renderMode === "alien"}
                      disabled={isSynthesisInProgress}
                      name="render-mode"
                      onChange={() => setRenderMode("alien")}
                      type="radio"
                      value="alien"
                    />
                    外星伪语播报
                  </label>
                </div>
                <p className="synthesis-mode-note">
                  {renderMode === "alien"
                    ? "本次实际合成会将外星伪语发送给 TTS；中文只保留在稿件与字幕中。"
                    : "本次实际合成会将中文稿件发送给 TTS。"}
                </p>
                {renderMode === "alien" && (
                  <label className="synthesis-profile">
                    <span>外星方言</span>
                    <select
                      disabled={isSynthesisInProgress}
                      onChange={(event) =>
                        setAlienDialect(event.target.value as AlienDialect)
                      }
                      value={alienDialect}
                    >
                      {alienDialectOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="synthesis-profile">
                  <span>表现风格</span>
                  <select
                    disabled={isSynthesisInProgress}
                    onChange={(event) =>
                      setDeliveryProfile(event.target.value as DeliveryProfileId)
                    }
                    value={effectiveDeliveryProfile}
                  >
                    {deliveryProfileIds.map((id) => (
                      <option key={id} value={id}>
                        {getDeliveryProfile(id).label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="text-button"
                  disabled={isSynthesisInProgress}
                  onClick={() => void synthesizeSpeech(renderMode)}
                  type="button"
                >
                  {isSelectedProgramSynthesizing
                    ? "正在合成语音…"
                    : selected?.status === "ready"
                      ? `以${getRenderModeLabel(renderMode)}重新生成音频`
                      : `以${getRenderModeLabel(renderMode)}合成语音`}
                </button>
              </div>
            </div>
          )}
          <div className="detail-section">
            <h3>稿件</h3>
            {selectedScript ? (
              <div className="script-preview">
                <p>虚构广播 · {selectedScript.language}</p>
                {selectedScript.segments.map((segment, index) => (
                  <p key={`${segment.speaker}-${index}`}>
                    <strong>{segment.speaker}：</strong>
                    {segment.text}
                  </p>
                ))}
              </div>
            ) : selected ? (
              <p>稿件尚未生成。</p>
            ) : (
              <p>尚未选择节目</p>
            )}
          </div>
          </aside>
        </div>
      )}
    </main>
  );
}
