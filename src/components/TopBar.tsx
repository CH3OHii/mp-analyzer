import { resolveAnalysisPresets } from "../agent/presets";
import { useT } from "../i18n";
import { resetChat } from "../store/chatStore";
import { updateSettings, useSettings } from "../store/settings";

export default function TopBar({ onSettings, onPicker }: { onSettings: () => void; onPicker: () => void }) {
  const t = useT();
  const s = useSettings();
  const presets = resolveAnalysisPresets(s.customPresets);
  const active = s.analysisPresetId ? presets.find((p) => p.id === s.analysisPresetId) : null;
  const label = active ? (s.language === "zh" ? active.nameZh : active.nameEn) : t.nonePreset;
  return (
    <div className="topbar">
      <span className="title">{t.appTitle}</span>
      <button className={`chip ${active || s.styleLayerOn ? "active" : ""}`} onClick={onPicker} title={t.presets}>
        {label}
        {s.styleLayerOn ? " +🎨" : ""}
      </button>
      <button
        className="iconbtn"
        title={t.language}
        onClick={() => updateSettings({ language: s.language === "zh" ? "en" : "zh" })}
      >
        {s.language === "zh" ? "EN" : "中"}
      </button>
      <button className="iconbtn" title={t.newChat} onClick={resetChat}>
        ✚
      </button>
      <button className="iconbtn" title={t.settings} onClick={onSettings}>
        ⚙
      </button>
    </div>
  );
}
