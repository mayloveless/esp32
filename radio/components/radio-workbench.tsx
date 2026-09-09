"use client";

import { useState } from "react";
import { programFormats, type ProgramFormat } from "../program/types";

export function RadioWorkbench() {
  const [format, setFormat] = useState<ProgramFormat>("news");
  const [language, setLanguage] = useState("中文");
  const [style, setStyle] = useState("冷静、略带未知感");

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
            <p>设置节目参数后生成。生成能力将在后续阶段接入。</p>
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
            <input onChange={(event) => setLanguage(event.target.value)} value={language} />
          </label>
          <label>
            <span>风格</span>
            <input onChange={(event) => setStyle(event.target.value)} value={style} />
          </label>
        </div>
        <button className="primary-button" disabled type="button">
          生成节目
        </button>
      </section>

      <div className="management-grid">
        <section className="panel program-list" aria-labelledby="library-heading">
          <div className="panel-heading">
            <div>
              <h2 id="library-heading">节目列表</h2>
              <p>生成并保存的节目会显示在这里。</p>
            </div>
            <span className="count" aria-label="节目数量">0 个节目</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">节目</th>
                  <th scope="col">形式</th>
                  <th scope="col">状态</th>
                  <th scope="col">创建时间</th>
                  <th scope="col"><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                <tr className="empty-row">
                  <td colSpan={5}>暂无节目。生成服务接通后，可在此查看状态、试听、稿件和删除节目。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <aside className="panel detail-panel" aria-labelledby="detail-heading">
          <div className="panel-heading">
            <div>
              <h2 id="detail-heading">节目详情</h2>
              <p>从节目列表选择一条节目后查看。</p>
            </div>
          </div>
          <div className="detail-section">
            <h3>稿件</h3>
            <p>尚未选择节目</p>
          </div>
          <div className="detail-section">
            <h3>音频</h3>
            <p>尚无可试听的音频</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
