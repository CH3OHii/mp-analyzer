import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

function render() {
  createRoot(document.getElementById("root")!).render(<App />);
}

// Office.js is loaded from the CDN in index.html. In a plain browser (no Excel)
// it may be absent — render anyway so the UI can be previewed and diagnosed.
if (typeof Office !== "undefined" && Office.onReady) {
  Office.onReady(() => render());
} else {
  render();
}
