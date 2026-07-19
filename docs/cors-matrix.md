# CORS matrix — direct browser calls from the Excel task pane

Fill this in from **Settings → Run CORS diagnostics** inside the task pane running in
desktop Excel (not a regular browser — WKWebView/WebView2 enforce CORS differently).
A `401 Unauthorized` **with a response you can read** counts as PASS (CORS allowed,
key wrong); a network/TypeError failure counts as FAIL (blocked by CORS).

| Provider | Endpoint | Desktop Chromium (reference) | Mac (WKWebView) direct | Windows (WebView2) direct | Proxy needed? |
| --- | --- | --- | --- | --- | --- |
| DeepSeek | api.deepseek.com | ✅ 2026-07-19 (readable 401) | ☐ untested | ☐ untested | ☐ |
| Kimi (Moonshot) | api.moonshot.cn | ✅ 2026-07-19 (readable 401) | ☐ untested | ☐ untested | ☐ |
| GLM (Zhipu) | open.bigmodel.cn | ✅ 2026-07-19 (readable 401) | ☐ untested | ☐ untested | ☐ |
| Qwen (DashScope) | dashscope.aliyuncs.com | ✅ 2026-07-19 (readable 401) | ☐ untested | ☐ untested | ☐ |
| MiniMax | api.minimaxi.com + api.minimax.io | ✅ 2026-07-19 (readable 401, both) | ☐ untested | ☐ untested | ☐ |

Reference test 2026-07-19: non-stream POST probes from a desktop Chromium page — ALL
five providers (six endpoints) returned readable HTTP 401 with a dummy key, meaning
their servers send permissive CORS headers. Strong signal the Office webview will
also pass; confirm with the in-pane diagnostics anyway.

Notes:
- Test both non-streaming and `stream: true` — some gateways treat SSE differently.
- Any provider failing direct: flip on **Use proxy** in Settings and run `npm run proxy`.
- Record the date tested; providers change CORS policy without notice.
