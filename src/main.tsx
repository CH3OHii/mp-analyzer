import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

function render() {
  createRoot(document.getElementById("root")!).render(<App />);
}

// Office.js is loaded from the CDN in index.html. In a plain browser (no Excel)
// it may be absent — render anyway so the UI can be previewed and diagnosed.
if (typeof Office !== "undefined" && Office.onReady) {
  Office.onReady((info) => {
    // Excel floats its own ⓘ "personality menu" over the pane's top-right corner
    // in every desktop/web host. Flag that we're inside an Office host (any
    // platform) so CSS can pad our controls clear of it — don't depend on the
    // exact platform string, which can be empty at load time.
    try {
      if (typeof Office !== "undefined" && Office.context) {
        document.body.dataset.inOffice = "true";
        const plat = String(info?.platform ?? Office.context.platform ?? "unknown");
        document.body.dataset.platform = plat;
        // one-shot diagnostic → appears in the local server log so host detection
        // can be confirmed without seeing inside Excel
        fetch("/__diag/host/" + encodeURIComponent(plat)).catch(() => {});
      }
    } catch {
      /* not in a full Office host */
    }
    render();
  });
} else {
  render();
}
