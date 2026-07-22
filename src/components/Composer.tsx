import { Palette, X } from "lucide-react";
import { useRef, useState } from "react";
import { sendOrQueue } from "../agent/dispatch";
import { filterPresets, resolveAnalysisPresets, styleLayerPreset, type Preset } from "../agent/presets";
import { useT } from "../i18n";
import { removeQueuedAt, stopTurn, useChat } from "../store/chatStore";
import { updateSettings, useSettings } from "../store/settings";
import SlashMenu, { type SlashEntry } from "./SlashMenu";

/** "/" as first char, no whitespace yet — a space turns it back into plain text. */
const SLASH_RE = /^\/\S*$/;

export default function Composer() {
  const t = useT();
  const s = useSettings();
  const chatState = useChat();
  const [text, setText] = useState("");
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // IME guard: while a Chinese composition is active, intercept NOTHING —
  // Enter confirms the composition and arrows navigate candidates.
  const composing = useRef(false);

  const presets = resolveAnalysisPresets(s.customPresets);
  const active = s.analysisPresetId ? presets.find((p) => p.id === s.analysisPresetId) : null;
  const nameOf = (p: Preset) => (s.language === "zh" ? p.nameZh : p.nameEn);

  const slashOpen = SLASH_RE.test(text) && !slashDismissed;
  const entries: SlashEntry[] = [];
  if (slashOpen) {
    const q = text.slice(1).toLowerCase();
    if (!q || t.nonePreset.toLowerCase().includes(q) || "none".includes(q)) {
      entries.push({ kind: "none", label: t.nonePreset, selected: !active });
    }
    for (const p of filterPresets(q, presets)) {
      entries.push({
        kind: "preset",
        id: p.id,
        label: nameOf(p),
        sub: `~${(p.approxTokens / 1000).toFixed(1)}k tokens${p.source === "custom" ? " · custom" : ""}`,
        selected: p.id === s.analysisPresetId,
      });
    }
    if (
      styleLayerPreset &&
      (!q || t.styleLayer.toLowerCase().includes(q) || "style".includes(q) || styleLayerPreset.nameZh.includes(q))
    ) {
      entries.push({
        kind: "style",
        label: t.styleLayer,
        sub: `~${(styleLayerPreset.approxTokens / 1000).toFixed(1)}k`,
        on: s.styleLayerOn,
      });
    }
  }
  const hi = Math.min(highlight, Math.max(0, entries.length - 1));

  function pick(en: SlashEntry) {
    if (en.kind === "none") updateSettings({ analysisPresetId: null });
    else if (en.kind === "preset") updateSettings({ analysisPresetId: en.id });
    else updateSettings({ styleLayerOn: !s.styleLayerOn });
    setText("");
    setHighlight(0);
    setSlashDismissed(false);
  }

  function send() {
    const msg = text.trim();
    if (!msg) return;
    setText("");
    sendOrQueue(msg); // mid-turn sends queue; idle sends run immediately
  }

  return (
    <div className="composer-wrap">
      {slashOpen && entries.length > 0 && (
        <SlashMenu entries={entries} highlight={hi} onHover={setHighlight} onPick={pick} />
      )}
      {(active || s.styleLayerOn) && (
        <div className="pill-row">
          {active && (
            <span className="skill-pill">
              <span className="chip-text">{nameOf(active)}</span>
              <button
                className="chip-x"
                title={t.skillPillClear}
                onClick={() => updateSettings({ analysisPresetId: null })}
              >
                <X size={11} />
              </button>
            </span>
          )}
          {s.styleLayerOn && (
            <span className="skill-pill">
              <Palette size={11} />
              <span className="chip-text">{t.styleLayerPill}</span>
              <button className="chip-x" title={t.skillPillClear} onClick={() => updateSettings({ styleLayerOn: false })}>
                <X size={11} />
              </button>
            </span>
          )}
        </div>
      )}
      {chatState.queued.length > 0 && (
        <div className="queue-row">
          {chatState.queued.map((q, i) => (
            <span className="queued-chip" key={`${i}-${q.slice(0, 8)}`} title={t.queuedHint}>
              <span className="chip-text">{q}</span>
              <button className="chip-x" onClick={() => removeQueuedAt(i)} title={t.removeQueued}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        <textarea
          value={text}
          placeholder={t.composerPlaceholder}
          rows={2}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            setHighlight(0);
            if (!SLASH_RE.test(v)) setSlashDismissed(false);
          }}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing) return;
            if (slashOpen && entries.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((hi + 1) % entries.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((hi - 1 + entries.length) % entries.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(entries[hi]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlashDismissed(true);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {chatState.streaming ? (
          <button className="btn danger" onClick={stopTurn}>
            {t.stop}
          </button>
        ) : (
          <button className="btn primary" onClick={send} disabled={!text.trim()}>
            {t.send}
          </button>
        )}
      </div>
    </div>
  );
}
