import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { extractPlaceholders, fillTemplate, type PromptTemplate } from "../agent/promptTemplates";
import { useT } from "../i18n";
import { updateSettings, useSettings } from "../store/settings";

type Mode = { kind: "list" } | { kind: "edit"; id: string | null } | { kind: "fill"; tpl: PromptTemplate };

/** Prompt library: pick a template to insert into the composer; templates with
 *  {placeholders} go through a fill-in form first. Insert never auto-sends. */
export default function PromptLibraryPanel({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (text: string) => void;
}) {
  const t = useT();
  const s = useSettings();
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  function use(tpl: PromptTemplate) {
    if (extractPlaceholders(tpl.body).length === 0) {
      onInsert(tpl.body);
      return;
    }
    setValues({});
    setMode({ kind: "fill", tpl });
  }

  function startEdit(tpl: PromptTemplate | null) {
    setName(tpl?.name ?? "");
    setBody(tpl?.body ?? "");
    setMode({ kind: "edit", id: tpl?.id ?? null });
  }

  function saveTemplate() {
    const id = mode.kind === "edit" && mode.id ? mode.id : `tpl_${Date.now()}`;
    const next: PromptTemplate = { id, name: name.trim() || t.untitledChat, body };
    updateSettings({
      promptTemplates: [next, ...s.promptTemplates.filter((p) => p.id !== id)],
    });
    setMode({ kind: "list" });
  }

  function remove(id: string) {
    updateSettings({ promptTemplates: s.promptTemplates.filter((p) => p.id !== id) });
    setConfirmDel(null);
  }

  return (
    // "fixed": rendered inside .composer-wrap (position:relative), a plain
    // absolute panel would be clipped to the composer strip.
    <div className="panel fixed">
      <div className="head">
        {t.promptLibrary}
        <button className="iconbtn" onClick={onClose} title={t.close}>
          <X size={16} />
        </button>
      </div>

      {mode.kind === "list" && (
        <div className="body">
          {s.promptTemplates.length === 0 && <div className="blocking">{t.libraryEmpty}</div>}
          {s.promptTemplates.map((tpl) => (
            <div className="histrow" key={tpl.id}>
              <button className="histmain" onClick={() => use(tpl)}>
                <div className="histtitle">{tpl.name}</div>
                <div className="histmeta">
                  <span className="chip-text">{tpl.body.replace(/\s+/g, " ").slice(0, 60)}</span>
                </div>
              </button>
              <button className="iconbtn" title={t.edit} onClick={() => startEdit(tpl)}>
                <Pencil size={14} />
              </button>
              {confirmDel === tpl.id ? (
                <button className="btn small danger" onClick={() => remove(tpl.id)}>
                  {t.confirmDelete}
                </button>
              ) : (
                <button className="iconbtn" title={t.deleteChat} onClick={() => setConfirmDel(tpl.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn small" onClick={() => startEdit(null)}>
              <Plus size={13} />
              {t.newTemplate}
            </button>
          </div>
        </div>
      )}

      {mode.kind === "edit" && (
        <div className="body">
          <div className="field">
            <label>{t.templateName}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>{t.templateBody}</label>
            <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="hint">{t.templateExample}</div>
          </div>
          <div className="row">
            <button className="btn primary" disabled={!body.trim()} onClick={saveTemplate}>
              {t.save}
            </button>
            <button className="btn" onClick={() => setMode({ kind: "list" })}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {mode.kind === "fill" && (
        <div className="body">
          <div className="section-title" style={{ borderTop: "none", paddingTop: 0 }}>
            {mode.tpl.name} — {t.fillVariables}
          </div>
          {extractPlaceholders(mode.tpl.body).map((ph) => (
            <div className="field" key={ph}>
              <label>{ph}</label>
              <input
                type="text"
                value={values[ph] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [ph]: e.target.value }))}
              />
            </div>
          ))}
          <div className="row">
            <button className="btn primary" onClick={() => onInsert(fillTemplate(mode.tpl.body, values))}>
              {t.insertTemplate}
            </button>
            <button className="btn" onClick={() => setMode({ kind: "list" })}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
