import { useState } from "react";
import { useT } from "../i18n";
import { resolveDecision, useChat, type ToolCardModel } from "../store/chatStore";

/** Fixed approval bar above the composer — the always-reachable way to confirm
 *  a pending change, independent of chat scroll position or card height. */
export default function PendingBar() {
  const state = useChat();
  const item = state.items.find((it) => it.kind === "tool" && it.id === state.pendingCardId);
  if (state.pendingCardId == null || !item || item.kind !== "tool") return null;
  return <Inner key={item.id} card={item.card} />;
}

function Inner({ card }: { card: ToolCardModel }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  return (
    <div className="pendingbar">
      <span className="pb-label" title={t.pendingHint}>
        {card.mutating === "hard" ? "⚠️" : "⏸"} {card.name}
        {card.target ? ` → ${card.target}` : ""}
      </span>
      <button className="btn primary small" onClick={() => resolveDecision({ action: "apply" })}>
        {t.apply}
      </button>
      {card.mutating !== "hard" && (
        <button className="btn small" onClick={() => resolveDecision({ action: "apply-turn" })}>
          {t.applyTurn}
        </button>
      )}
      {!showReason ? (
        <button className="btn danger small" onClick={() => setShowReason(true)}>
          {t.reject}
        </button>
      ) : (
        <>
          <input
            autoFocus
            value={reason}
            placeholder={t.rejectReasonPlaceholder}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") resolveDecision({ action: "reject", reason: reason || undefined });
            }}
          />
          <button className="btn danger small" onClick={() => resolveDecision({ action: "reject", reason: reason || undefined })}>
            {t.rejectSend}
          </button>
        </>
      )}
    </div>
  );
}
