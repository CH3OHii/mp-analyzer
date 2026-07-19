import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

function render() {
  createRoot(document.getElementById("root")!).render(<App />);
}

// Office.js is loaded from the CDN in index.html. In a plain browser (no Excel)
// it may be absent — render anyway so the UI can be previewed and diagnosed.
if (typeof Office !== "undefined" && Office.onReady) {
  Office.onReady(() => {
    // Excel for Mac floats its own ⓘ "personality menu" over the pane's
    // top-right corner — expose the platform so CSS can pad around it.
    try {
      document.body.dataset.platform = String(Office.context?.platform ?? "");
    } catch {
      /* not in a full Office host */
    }
    render();
  });
} else {
  render();
}
