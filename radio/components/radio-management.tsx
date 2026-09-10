"use client";

import { type ChangeEvent, useEffect, useState } from "react";
import {
  programFormats,
  type BroadcastScript,
  type ProgramFormat,
  type RadioProgram,
} from "../program/types";

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

export function RadioManagement() {
  const [format, setFormat] = useState<ProgramFormat>("news");
  const [language, setLanguage] = useState("中文");
  const [style, setStyle] = useState("冷静、略带未知感");
  const [topic, setTopic] = useState("");
  const [programs, setPrograms] = useState<RadioProgram[]>([]);
  const [selected, setSelected] = useState<RadioProgram | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [audioRefreshAttempted, setAudioRefreshAttempted] = useState(false);
  const selectedScript = selected ? asBroadcastScript(selected.content) : null;

  async function loadPrograms() {
    try {
      setLoading(true);
      setPrograms(
        (await request<{ programs: RadioProgram[] }>("/api/programs")).programs,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取节目列表。");
    } finally {
      setLoading(false);
    }
  }

  async function selectProgram(id: string) {
    try {
      const program = (
        await request<{ program: RadioProgram }>(`/api/programs/${id}`)
      ).program;
      setSelected(program);
      setAudioFile(null);
      setAudioUrl(null);
      setAudioRefreshAttempted(false);
      if (program.audio_path) await refreshAudioUrl(id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取节目详情。");
    }
  }

  async function refreshAudioUrl(id: string) {
    try {
      const { signedUrl } = await request<{ signedUrl: string }>(
        `/api/programs/${id}/audio-url`,
      );
      setAudioUrl(signedUrl);
    } catch (error) {
      setAudioUrl(null);
      setMessage(
        error instanceof Error ? error.message : "无法刷新音频试听地址。",
      );
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
        setSelected(body.program);
        setAudioFile(null);
        setAudioUrl(null);
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

  async function deleteProgram(id: string) {
    if (!window.confirm("删除节目及其音频文件？此操作不可恢复。")) return;
    try {
      setSaving(true);
      const { cleanupWarning } = await request<{
        cleanupWarning: string | null;
      }>(`/api/programs/${id}`, { method: "DELETE" });
      if (selected?.id === id) {
        setSelected(null);
        setAudioUrl(null);
        setAudioFile(null);
      }
      await loadPrograms();
      if (cleanupWarning) setMessage(cleanupWarning);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法删除节目。");
    } finally {
      setSaving(false);
    }
  }

  async function uploadAudio() {
    if (!selected || !audioFile) return;
    try {
      setSaving(true);
      const formData = new FormData();
      formData.set("audio", audioFile);
      const response = await fetch(`/api/programs/${selected.id}/audio`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => ({}))) as {
        program?: RadioProgram;
        cleanupWarning?: string | null;
        error?: string;
      };
      if (!response.ok || !body.program)
        throw new Error(body.error ?? "无法上传音频。");
      await selectProgram(body.program.id);
      await loadPrograms();
      setMessage(body.cleanupWarning ?? "测试音频已上传。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法上传音频。");
    } finally {
      setSaving(false);
    }
  }

  function selectAudioFile(event: ChangeEvent<HTMLInputElement>) {
    setAudioFile(event.target.files?.[0] ?? null);
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
            <span className="count">{programs.length} 个节目</span>
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
                  <th scope="col">节目</th>
                  <th scope="col">形式</th>
                  <th scope="col">状态</th>
                  <th scope="col">创建时间</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr className="empty-row">
                    <td colSpan={5}>正在读取节目…</td>
                  </tr>
                )}
                {!loading && programs.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={5}>暂无节目。当前没有伪造的示例数据。</td>
                  </tr>
                )}
                {!loading &&
                  programs.map((program) => (
                    <tr key={program.id}>
                      <td>{program.title || "未命名节目"}</td>
                      <td>{program.format}</td>
                      <td>
                        <span className={`status status-${program.status}`}>
                          {program.status}
                        </span>
                      </td>
                      <td>
                        {dateFormatter.format(new Date(program.created_at))}
                      </td>
                      <td className="row-actions">
                        <button
                          className="text-button"
                          onClick={() => void selectProgram(program.id)}
                          type="button"
                        >
                          查看
                        </button>
                        <button
                          className="text-button danger-button"
                          disabled={saving}
                          onClick={() => void deleteProgram(program.id)}
                          type="button"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="panel detail-panel" aria-labelledby="detail-heading">
          <div className="panel-heading">
            <div>
              <h2 id="detail-heading">节目详情</h2>
              <p>
                {selected
                  ? selected.title || "未命名节目"
                  : "从节目列表选择一条节目后查看。"}
              </p>
            </div>
          </div>
          <div className="detail-section">
            <h3>状态</h3>
            <p>{selected?.status ?? "尚未选择节目"}</p>
            {selected?.error && <p className="program-error">{selected.error}</p>}
          </div>
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
          <div className="detail-section">
            <h3>音频</h3>
            {audioUrl ? (
              <audio
                aria-label="节目音频播放器"
                controls
                onError={handleAudioError}
                src={audioUrl}
              />
            ) : (
              <p>尚无可试听的音频</p>
            )}
            {selected && (
              <div className="upload-controls">
                <input
                  accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac"
                  onChange={selectAudioFile}
                  type="file"
                />
                <button
                  className="text-button"
                  disabled={!audioFile || saving}
                  onClick={() => void uploadAudio()}
                  type="button"
                >
                  上传测试音频
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
