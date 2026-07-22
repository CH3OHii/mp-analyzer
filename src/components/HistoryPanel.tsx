import { FileSpreadsheet, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n";
import { clearAllChats, deleteChat, listChats, openChat, type ChatSummary } from "../store/chatHistory";
import { useChat } from "../store/chatStore";
import { useSettings } from "../store/settings";

/** Coarse relative time — good enough for a history list, no date library. */
function relativeDate(ts: number, lang: "en" | "zh"): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return lang === "zh" ? "刚刚" : "just now";
  if (mins < 60) return lang === "zh" ? `${mins} 分钟前` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return lang === "zh" ? `${hrs} 小时前` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return lang === "zh" ? `${days} 天前` : `${days}d ago`;
  return new Date(ts).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US");
}

export default function HistoryPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { language } = useSettings();
  const chatState = useChat();
  const [chats, setChats] = useState<ChatSummary[]>(() => listChats());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  async function open(id: string) {
    if (chatState.streaming) return; // never swap context mid-turn
    if (await openChat(id)) onClose();
  }

  function remove(id: string) {
    deleteChat(id);
    setChats(listChats());
    setConfirmId(null);
  }

  return (
    <div className="panel">
      <div className="head">
        {t.history}
        <button className="iconbtn" onClick={onClose} title={t.close}>
          <X size={16} />
        </button>
      </div>
      <div className="body">
        {chatState.streaming && <div className="hint">{t.historyBusy}</div>}
        {chats.length === 0 && <div className="blocking">{t.historyEmpty}</div>}

        {chats.map((c) => (
          <div className="histrow" key={c.id}>
            <button className="histmain" onClick={() => open(c.id)} disabled={chatState.streaming}>
              <div className="histtitle">{c.title || t.untitledChat}</div>
              <div className="histmeta">
                {c.workbook && (
                  <span className="wbbadge">
                    <FileSpreadsheet size={10} />
                    {c.workbook}
                  </span>
                )}
                <span>{relativeDate(c.updatedAt, language)}</span>
                <span>·</span>
                <span>{t.messagesCount(c.messageCount)}</span>
              </div>
            </button>
            {confirmId === c.id ? (
              <button className="btn small danger" onClick={() => remove(c.id)}>
                {t.confirmDelete}
              </button>
            ) : (
              <button className="iconbtn" title={t.deleteChat} onClick={() => setConfirmId(c.id)}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}

        {chats.length > 0 && (
          <div className="row" style={{ marginTop: 4 }}>
            {confirmClear ? (
              <button
                className="btn small danger"
                onClick={() => {
                  clearAllChats();
                  setChats([]);
                  setConfirmClear(false);
                }}
              >
                {t.confirmClearAll}
              </button>
            ) : (
              <button className="btn small" onClick={() => setConfirmClear(true)}>
                {t.clearAllHistory}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
