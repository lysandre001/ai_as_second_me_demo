## Resume Autofill Assistant (Chrome Extension)

Generate concise text for web forms from your own context and field hints. The popup always shows the latest output for copy/paste.

### Install
1) Open Chrome and go to `chrome://extensions/`.
2) Enable Developer mode (top right).
3) Click “Load unpacked” and select this project folder.

### Configure
Open popup → Settings (API):
- Model: e.g. gemini-1.5-flash-latest
- API Key: your credential
- Click Test to verify.

### Use
1) Profile: add blocks (context type + text). Set “Output style”. Click Save.
2) On a normal HTTPS page, right‑click the target input and choose “Autofill it with my context”.
3) The extension extracts hints (label/placeholder/aria/name/nearby text + page title), calls your model, and:
   - Tries to insert into the field
   - Always writes the result to popup → “Last output” (Copy / Refresh / Clear; read‑only)

### Features
- Right‑click to generate
- “your context” blocks with “context type” + details; “+ More” to add
- “Output style” to control tone/length/format
- “Last output”: always visible, copy/refresh/clear; read‑only
- Context extraction: label, placeholder, aria-label, name, nearby text, page title

### Privacy
- Context and API config are stored locally in `chrome.storage.local`.
- Data is sent to your configured API only when you trigger generation.
