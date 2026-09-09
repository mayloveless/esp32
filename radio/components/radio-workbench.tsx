"use client";

import { useState } from "react";
import { programFormats, type ProgramFormat } from "../program/types";

export function RadioWorkbench() {
  const [format, setFormat] = useState<ProgramFormat>("news");
  const [language, setLanguage] = useState("中文");
  const [style, setStyle] = useState("冷静、略带未知感");

  return (
    <main className="workbench">
      <header className="masthead">
        <p className="station-mark">COSMIC RADIO / 001</p>
        <h1>宇宙电台实验台</h1>
        <p>先调好这一条信号，再决定它是否值得被听见。</p>
      </header>

      <section className="console" aria-labelledby="compose-heading">
        <div className="console-heading">
          <p className="section-label">节目配方</p>
          <h2 id="compose-heading">调谐新的节目</h2>
        </div>
        <div className="form-grid">
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
            <input onChange={(event) => setLanguage(event.target.value)} value={language} />
          </label>
          <label>
            <span>风格</span>
            <input onChange={(event) => setStyle(event.target.value)} value={style} />
          </label>
        </div>
        <button className="tune-button" type="button">
          生成节目（将在下一阶段接通）
        </button>
      </section>

      <section className="listening-room" aria-labelledby="preview-heading">
        <div className="paper-panel">
          <p className="section-label">内容预览</p>
          <h2 id="preview-heading">等待一条信号</h2>
          <p>
            已设为{language} {format === "news" ? "新闻" : "聊天"}，风格是“{style}”。
            生成服务尚未接通，因此这里不会伪造稿件或生成结果。
          </p>
        </div>
        <div className="audio-panel">
          <p className="section-label">收听</p>
          <div className="waveform" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
          <p>没有可播放的节目</p>
          <audio aria-label="节目音频播放器" controls />
        </div>
      </section>

      <section className="program-list" aria-labelledby="library-heading">
        <div>
          <p className="section-label">节目列表</p>
          <h2 id="library-heading">档案仍然为空</h2>
        </div>
        <p>第一条节目生成并保存后，会在这里出现。</p>
      </section>
    </main>
  );
}
