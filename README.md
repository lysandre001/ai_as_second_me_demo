## Resume Autofill Assistant (Chrome Extension)

Generate concise text for web forms from your own context and field hints. The popup always shows the latest output for copy/paste.

### Install
1) Open Chrome and go to `chrome://extensions/`.
2) Enable Developer mode (top right).
3) Click “Load unpacked” and select this project folder.

### Configure
Open popup → Settings (API):
- Model: e.g. `gpt-4.1-mini` or `gemini-1.5-flash-latest`
- API Key: your credential
- Provider and Base URL are auto-detected from your model (and key). No need to set.
Click Test to verify.

### Use
1) In the popup or Options → Profile: add blocks (context type + text). Set “Output style”. Click Save.
2) On a normal HTTPS page, right‑click the target input and choose “Autofill it with my context”.
3) The extension extracts hints (label/placeholder/aria/name/nearby text + page title), calls your model, and:
   - Tries to insert into the field
   - Always writes the result to popup → “Last output” (Copy / Refresh / Clear; read‑only)

### Features
- Right‑click to generate（primary）
- “your context” blocks with “context type” + details; “+ More” to add
- “Output style” to control tone/length/format
- “Last output”: always visible, copy/refresh/clear; read‑only
- Context extraction: label, placeholder, aria-label, name, nearby text, page title

### Privacy
- Context and API config are stored locally in `chrome.storage.local`.
- Data is sent to your configured API only when you trigger generation.

### FAQ
- “Receiving end does not exist”: the frame/page blocks content scripts (`chrome://`, Web Store, PDF, cross‑origin iframe). Try a normal HTTPS page and right‑click the real input.
- Call failed: fix Base URL/Model/API Key to match your provider.
- No output in popup: click Refresh in “Last output”. Check the Service Worker console for errors if still empty.

### Development
- Key files
  - `manifest.json`: MV3 manifest
  - `background.js`: messaging, LLM calls, right‑click menu
  - `content-script.js`: context extraction, field insertion, page session cache
  - `content-style.css`: content‑script styles (no inline styles; CSP‑friendly)
  - `popup.html` / `popup.js`: popup UI (context, output style, last output)
- `options.html` / `options.js`: settings (provider/model/key; optional Base URL) + profile editor
