import { Check, Palette } from "lucide-react";

/** One row of the "/" menu. Labels/subs are pre-localized by the composer. */
export type SlashEntry =
  | { kind: "preset"; id: string; label: string; sub: string; selected: boolean }
  | { kind: "style"; label: string; sub: string; on: boolean };

export default function SlashMenu({
  entries,
  highlight,
  onHover,
  onPick,
}: {
  entries: SlashEntry[];
  highlight: number;
  onHover: (index: number) => void;
  onPick: (entry: SlashEntry) => void;
}) {
  return (
    <div className="popover slash-menu">
      {entries.map((en, i) => (
        <div
          key={en.kind === "preset" ? en.id : en.kind}
          className={`option ${i === highlight ? "selected" : ""}`}
          onMouseEnter={() => onHover(i)}
          // mousedown (not click) + preventDefault: the textarea must not blur,
          // or the menu unmounts before the click lands.
          onMouseDown={(ev) => {
            ev.preventDefault();
            onPick(en);
          }}
        >
          <div className="option-label">
            {en.kind === "style" && <Palette size={12} />}
            <span className="chip-text">{en.label}</span>
            {(en.kind === "style" ? en.on : en.selected) && <Check size={12} className="option-check" />}
          </div>
          {en.sub && <div className="sub">{en.sub}</div>}
        </div>
      ))}
    </div>
  );
}
