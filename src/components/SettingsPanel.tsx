import { Eye, EyeOff, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n";
import { testConnection } from "../llm/client";
import { PROVIDER_PRESETS, getPreset } from "../llm/providers";
import type { ProviderId } from "../llm/types";
import { effectiveLlm, switchProvider, updateSettings, useSettings, type CustomPreset } from "../store/settings";

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const s = useSettings();
  const [testMsg, setTestMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [diag, setDiag] = useState("");
  const [diagRunning, setDiagRunning] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [editing, setEditing] = useState<CustomPreset | null>(null);

  const preset = getPreset(s.llm.providerId);
  const key = s.apiKeys[s.llm.providerId] ?? "";

  async function onTest() {
    setTesting(true);
    setTestMsg("");
    const r = await testConnection(effectiveLlm(s));
    setTestMsg(`${r.corsOk ? "CORS ✓" : "CORS ✗"} — ${r.message}`);
    setTesting(false);
  }

  async function onDiag() {
    setDiagRunning(true);
    const lines: string[] = [];
    setDiag("running…");
    for (const p of PROVIDER_PRESETS.filter((x) => x.id !== "custom")) {
      for (const streaming of [false, true]) {
        const r = await testConnection(
          {
            providerId: p.id,
            baseUrl: p.baseUrls[0],
            model: p.defaultModel,
            apiKey: s.apiKeys[p.id] ?? "",
            useProxy: false,
            proxyUrl: s.llm.proxyUrl,
            temperature: 0,
            maxTokens: 1,
          },
          streaming
        );
        lines.push(
          `${p.label} ${streaming ? "stream" : "basic "}: ${r.corsOk ? "CORS ✓" : "CORS ✗"} ${r.status ?? ""} ${
            r.corsOk ? "" : r.message
          }`.trim()
        );
        setDiag(lines.join("\n"));
      }
    }
    setDiagRunning(false);
  }

  function savePreset() {
    if (!editing) return;
    const rest = s.customPresets.filter((p) => p.id !== editing.id);
    updateSettings({ customPresets: [...rest, editing] });
    setEditing(null);
  }

  return (
    <div className="panel">
      <div className="head">
        {t.settings}
        <button className="iconbtn" onClick={onClose} title={t.close}>
          <X size={16} />
        </button>
      </div>
      <div className="body">
        <div className="section-title" style={{ borderTop: "none", paddingTop: 0 }}>
          {t.generalSection}
        </div>
        <div className="field">
          <label>{t.language}</label>
          <select value={s.language} onChange={(e) => updateSettings({ language: e.target.value as "en" | "zh" })}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
        <label className="row">
          <input type="checkbox" checked={s.autoApply} onChange={(e) => updateSettings({ autoApply: e.target.checked })} />
          {t.autoApply}
        </label>
        <div className="field">
          <label>{t.verifyModeLabel}</label>
          <select
            value={s.verifyMode}
            onChange={(e) => updateSettings({ verifyMode: e.target.value as "off" | "basic" | "full" })}
          >
            <option value="full">{t.verifyModeFull}</option>
            <option value="basic">{t.verifyModeBasic}</option>
            <option value="off">{t.verifyModeOff}</option>
          </select>
          <div className="hint">{t.verifyModeHint}</div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>{t.contextBudget}</label>
            <input
              type="number"
              value={s.contextBudgetTokens}
              min={8000}
              step={1000}
              onChange={(e) => updateSettings({ contextBudgetTokens: Number(e.target.value) || 32000 })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>{t.maxIters}</label>
            <input
              type="number"
              value={s.maxIters}
              min={1}
              max={50}
              onChange={(e) => updateSettings({ maxIters: Number(e.target.value) || 15 })}
            />
          </div>
        </div>

        <div className="section-title">{t.providerSection}</div>
        <div className="field">
          <label>{t.provider}</label>
          <select value={s.llm.providerId} onChange={(e) => switchProvider(e.target.value as ProviderId)}>
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t.baseUrl}</label>
          <input type="text" value={s.llm.baseUrl} onChange={(e) => updateSettings({ llm: { baseUrl: e.target.value } })} />
          {preset.baseUrls.length > 1 && (
            <div className="row">
              <button className="btn small" onClick={() => updateSettings({ llm: { baseUrl: preset.baseUrls[0] } })}>
                {t.cnEndpoint}
              </button>
              <button className="btn small" onClick={() => updateSettings({ llm: { baseUrl: preset.baseUrls[1] } })}>
                {t.intlEndpoint}
              </button>
            </div>
          )}
        </div>
        <div className="field">
          <label>{t.model}</label>
          <input
            type="text"
            list="model-suggestions"
            value={s.llm.model}
            onChange={(e) => updateSettings({ llm: { model: e.target.value } })}
          />
          <datalist id="model-suggestions">
            {preset.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="hint">{t.modelHint}</div>
        </div>
        <div className="field">
          <label>{t.apiKey}</label>
          <div className="row">
            <input
              style={{ flex: 1 }}
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => updateSettings({ apiKeys: { [s.llm.providerId]: e.target.value } })}
              autoComplete="off"
            />
            <button className="btn small" onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="hint">{t.apiKeyHint}</div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>{t.temperature}</label>
            <input
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={s.llm.temperature}
              onChange={(e) => updateSettings({ llm: { temperature: Number(e.target.value) } })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>{t.maxTokens}</label>
            <input
              type="number"
              step={512}
              min={256}
              value={s.llm.maxTokens}
              onChange={(e) => updateSettings({ llm: { maxTokens: Number(e.target.value) || 4096 } })}
            />
          </div>
        </div>
        <div className="row">
          <button className="btn" disabled={testing} onClick={onTest}>
            {testing ? t.testing : t.testConnection}
          </button>
          {testMsg && <span className="hint">{testMsg}</span>}
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={s.llm.useProxy}
            onChange={(e) => updateSettings({ llm: { useProxy: e.target.checked } })}
          />
          {t.useProxy}
        </label>
        {s.llm.useProxy && (
          <div className="field">
            <label>{t.proxyUrl}</label>
            <input type="text" value={s.llm.proxyUrl} onChange={(e) => updateSettings({ llm: { proxyUrl: e.target.value } })} />
          </div>
        )}
        <div className="hint">{t.proxyHint}</div>

        <div className="section-title">{t.diagnosticsSection}</div>
        <button className="btn" disabled={diagRunning} onClick={onDiag}>
          {t.runDiagnostics}
        </button>
        <div className="hint">{t.diagHint}</div>
        {diag && <div className="diag-result">{diag}</div>}

        <div className="section-title">{t.presetSection}</div>
        {s.customPresets.map((p) => (
          <div key={p.id} className="row">
            <span style={{ flex: 1 }}>
              {p.nameZh || p.nameEn} <span className="hint">({(p.body.length / 1000).toFixed(1)}k chars)</span>
            </span>
            <button className="btn small" onClick={() => setEditing({ ...p })}>
              <Pencil size={13} />
            </button>
            <button
              className="btn small danger"
              onClick={() => updateSettings({ customPresets: s.customPresets.filter((x) => x.id !== p.id) })}
            >
              {t.delete}
            </button>
          </div>
        ))}
        {editing ? (
          <div className="field">
            <div className="row">
              <input
                style={{ flex: 1 }}
                type="text"
                placeholder={t.presetNameEn}
                value={editing.nameEn}
                onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
              />
              <input
                style={{ flex: 1 }}
                type="text"
                placeholder={t.presetNameZh}
                value={editing.nameZh}
                onChange={(e) => setEditing({ ...editing, nameZh: e.target.value })}
              />
            </div>
            <textarea
              rows={8}
              placeholder={t.presetBody}
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            />
            <div className="row">
              <button className="btn primary" onClick={savePreset} disabled={!editing.body.trim()}>
                {t.save}
              </button>
              <button className="btn" onClick={() => setEditing(null)}>
                {t.close}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn"
            onClick={() => setEditing({ id: `custom_${Date.now()}`, nameEn: "", nameZh: "", body: "" })}
          >
            {t.addPreset}
          </button>
        )}
      </div>
    </div>
  );
}
