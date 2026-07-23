import { History, Plus, Settings } from "lucide-react";
import { useT } from "../i18n";
import { newChatWithSave } from "../store/chatHistory";

export default function TopBar({ onSettings, onHistory }: { onSettings: () => void; onHistory: () => void }) {
  const t = useT();
  // Language lives in Settings → it is a set-once preference, not a per-turn control.
  return (
    <div className="topbar">
      <span className="title">{t.appTitle}</span>
      {/* Banks the outgoing conversation into history before clearing. */}
      <button className="iconbtn" title={t.newChat} onClick={() => void newChatWithSave()}>
        <Plus size={16} />
      </button>
      <button className="iconbtn" title={t.history} onClick={onHistory}>
        <History size={16} />
      </button>
      <button className="iconbtn" title={t.settings} onClick={onSettings}>
        <Settings size={16} />
      </button>
    </div>
  );
}
