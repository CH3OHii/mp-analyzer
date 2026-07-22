import { Plus, Settings } from "lucide-react";
import { useT } from "../i18n";
import { resetChat } from "../store/chatStore";
import { updateSettings, useSettings } from "../store/settings";

export default function TopBar({ onSettings }: { onSettings: () => void }) {
  const t = useT();
  const s = useSettings();
  return (
    <div className="topbar">
      <span className="title">{t.appTitle}</span>
      <button
        className="iconbtn"
        title={t.language}
        onClick={() => updateSettings({ language: s.language === "zh" ? "en" : "zh" })}
      >
        {s.language === "zh" ? "EN" : "中"}
      </button>
      <button className="iconbtn" title={t.newChat} onClick={resetChat}>
        <Plus size={16} />
      </button>
      <button className="iconbtn" title={t.settings} onClick={onSettings}>
        <Settings size={16} />
      </button>
    </div>
  );
}
