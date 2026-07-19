import { useRef, useState } from "react";
import { runTurn } from "../agent/loop";
import { useT } from "../i18n";
import { stopTurn, useChat } from "../store/chatStore";

export default function Composer() {
  const t = useT();
  const chatState = useChat();
  const [text, setText] = useState("");
  // IME guard: confirming a Chinese composition with Enter must NOT send.
  const composing = useRef(false);

  function send() {
    const msg = text.trim();
    if (!msg || chatState.streaming) return;
    setText("");
    void runTurn(msg);
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        placeholder={t.composerPlaceholder}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
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
  );
}
