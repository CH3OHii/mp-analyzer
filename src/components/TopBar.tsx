import { History, Plus, Settings } from "lucide-react";
import { useT } from "../i18n";
import { newChatWithSave } from "../store/chatHistory";
import { updateSettings, useSettings } from "../store/settings";

export default function TopBar({ onSettings, onHistory }: { onSettings: () => void; onHistory: () => void }) {
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
      <button className="iconbtn" title={t.history} onClick={onHistory}>
        <History size={16} />
      </button>
      {/* Banks the outgoing conversation into history before clearing. */}
      <button className="iconbtn" title={t.newChat} onClick={() => void newChatWithSave()}>
        <Plus size={16} />
      </button>
      <button className="iconbtn" title={t.settings} onClick={onSettings}>
        <Settings size={16} />
      </button>
    </div>
  );
}
