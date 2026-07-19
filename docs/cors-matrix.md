# CORS matrix — direct browser calls from the Excel task pane

Fill this in from **Settings → Run CORS diagnostics** inside the task pane running in
desktop Excel (not a regular browser — WKWebView/WebView2 enforce CORS differently).
A `401 Unauthorized` **with a response you can read** counts as PASS (CORS allowed,
key wrong); a network/TypeError failure counts as FAIL (blocked by CORS).

| Provider | Endpoint | Mac (WKWebView) direct | Windows (WebView2) direct | Proxy needed? |
| --- | --- | --- | --- | --- |
| DeepSeek | api.deepseek.com | ☐ untested | ☐ untested | ☐ |
| Kimi (Moonshot) | api.moonshot.cn | ☐ untested | ☐ untested | ☐ |
| GLM (Zhipu) | open.bigmodel.cn | ☐ untested | ☐ untested | ☐ |
| Qwen (DashScope) | dashscope.aliyuncs.com | ☐ untested | ☐ untested | ☐ |
| MiniMax | api.minimaxi.com | ☐ untested | ☐ untested | ☐ |

Notes:
- Test both non-streaming and `stream: true` — some gateways treat SSE differently.
- Any provider failing direct: flip on **Use proxy** in Settings and run `npm run proxy`.
- Record the date tested; providers change CORS policy without notice.
