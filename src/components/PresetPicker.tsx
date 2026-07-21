import { resolveAnalysisPresets, styleLayerPreset } from "../agent/presets";
import { useT } from "../i18n";
import { updateSettings, useSettings } from "../store/settings";

export default function PresetPicker({ onClose }: { onClose: () => void }) {
  const t = useT();
  const s = useSettings();
  const presets = resolveAnalysisPresets(s.customPresets);
  const pick = (id: string | null) => {
    updateSettings({ analysisPresetId: id });
    onClose();
  };
  return (
    <div className="popover">
      <div className={`option ${s.analysisPresetId == null ? "selected" : ""}`} onClick={() => pick(null)}>
        {t.nonePreset}
      </div>
      {presets.map((p) => (
        <div key={p.id} className={`option ${s.analysisPresetId === p.id ? "selected" : ""}`} onClick={() => pick(p.id)}>
          {s.language === "zh" ? p.nameZh : p.nameEn}
          <div className="sub">
            ~{(p.approxTokens / 1000).toFixed(1)}k tokens
            {p.source === "custom" ? " · custom" : ""}
          </div>
        </div>
      ))}
      {styleLayerPreset && (
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={s.styleLayerOn}
            onChange={(e) => updateSettings({ styleLayerOn: e.target.checked })}
          />
          {t.styleLayer}
          <span className="sub">~{(styleLayerPreset.approxTokens / 1000).toFixed(1)}k</span>
        </label>
      )}
    </div>
  );
}
