import { useT } from "../i18n";
import type { PendingPreview } from "../store/chatStore";

function Grid({ data }: { data: unknown[][] }) {
  return (
    <table>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            {row.map((c, j) => (
              <td key={j}>{c === null || c === undefined ? "" : String(c)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PendingChange({ preview }: { preview: PendingPreview }) {
  const t = useT();
  return (
    <div className="preview">
      {preview.note && <div className="hint">{preview.note}</div>}
      {preview.before && (
        <>
          <div className="grid-label">
            {t.before} {preview.address ?? ""}
          </div>
          <Grid data={preview.before} />
        </>
      )}
      {preview.after && (
        <>
          <div className="grid-label">{t.after}</div>
          <Grid data={preview.after} />
        </>
      )}
      {preview.moreRows ? <div className="more">{t.moreRows(preview.moreRows)}</div> : null}
    </div>
  );
}
