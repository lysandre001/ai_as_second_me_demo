const modelEl = document.getElementById('model');
const apiKeyEl = document.getElementById('apiKey');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');
const closeBtn = document.getElementById('closeOptions');
const testBtn = document.getElementById('test');
// Profile UI removed from Settings

// 防抖与状态提示
let testing = false;

// No Base URL field anymore; defaults are inferred

async function loadConfig() {
  const res = await chrome.runtime.sendMessage({ type: 'get_api_config' }).catch(() => null);
  if (res?.ok) {
    const cfg = res.config || {};
    modelEl.value = cfg.model || 'gemini-2.5-flash';
    apiKeyEl.value = cfg.apiKey || '';
  }
}

saveBtn.addEventListener('click', async () => {
  const config = {
    model: modelEl.value.trim(),
    apiKey: apiKeyEl.value.trim()
  };
  if (!config.model) {
    setStatus('Model is required');
    return;
  }
  const res = await chrome.runtime.sendMessage({ type: 'save_api_config', config }).catch(() => null);
  if (res?.ok) {
    setStatus('Saved');
  } else {
    setStatus('Save failed');
  }
});

function setStatus(text) {
  statusEl.textContent = text;
  setTimeout(() => { statusEl.textContent = ''; }, 2000);
}

loadConfig();

// Close button: return to previous page anytime
closeBtn?.addEventListener('click', () => {
  window.close();
});

// Connectivity test
testBtn?.addEventListener('click', async () => {
  if (testing) return; // debounce
  testing = true;
  const originalText = testBtn.textContent;
  try {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    setStatus('Testing...');

    const config = {
      model: modelEl.value.trim(),
      apiKey: apiKeyEl.value.trim()
    };
    if (!config.model || !config.apiKey) {
      setStatus('Please fill Model and API Key');
      return;
    }

    const saved = await chrome.runtime.sendMessage({ type: 'save_api_config', config }).catch(() => null);
    if (!saved?.ok) {
      setStatus('Save config failed');
      return;
    }

    // 12s timeout
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 12000));
    const res = await Promise.race([
      chrome.runtime.sendMessage({
        type: 'generate_fill',
        question: 'Connectivity test: return OK.',
        pageContext: { pageTitle: 'Connectivity Test', maxLength: 20 }
      }),
      timeout
    ]).catch(err => ({ ok: false, error: String(err && err.message ? err.message : err) }));

    const text = (res && typeof res.text === 'string') ? res.text.trim() : '';
    const passed = !!(res?.ok && text);
    if (passed) {
      setStatus('Test passed');
    } else {
      setStatus(`Test failed: ${res?.error || (text ? 'Invalid response' : 'No response')}`);
    }
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = originalText;
    testing = false;
  }
});

// Profile UI removed from Settings
