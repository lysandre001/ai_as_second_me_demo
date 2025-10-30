const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');
const openOptions = document.getElementById('openOptions');
const lastOutputEl = document.getElementById('lastOutput');
const copyLastBtn = document.getElementById('copyLast');
const refreshLastBtn = document.getElementById('refreshLast');
const clearLastBtn = document.getElementById('clearLast');
const extrasContainer = document.getElementById('extrasContainer');
const addExtraBtn = document.getElementById('addExtra');
const extrasErrorEl = document.getElementById('extrasError');

const resumeFields = [ 'style-preference' ];

async function loadResume() {
  const res = await chrome.runtime.sendMessage({ type: 'get_resume' }).catch(() => null);
  if (res?.ok && res.resume) {
    for (const id of resumeFields) {
      const el = document.getElementById(id);
      if (el && res.resume[id]) {
        el.value = res.resume[id];
      }
    }
    // load extras or seed defaults
    const items = Array.isArray(res.resume?.extras) && res.resume.extras.length
      ? res.resume.extras
      : getDefaultExtras();
    renderExtras(items);
  }
}

saveBtn.addEventListener('click', async () => {
  const resume = {};
  for (const id of resumeFields) {
    const el = document.getElementById(id);
    if (el) {
      resume[id] = el.value || '';
    }
  }
  // collect extras
  const extras = collectExtras();
  if (!extras.length) {
    setExtrasError('Please add at least one context item');
    return;
  }
  const invalid = extras.find(x => !x.category.trim() || !x.detail.trim());
  if (extras.length && invalid) {
    setExtrasError('Category and detail are required');
    return;
  }
  resume.extras = extras;
  // 不再使用旧的 details 面板，保持与模型的兼容：others 由 extras 汇总
  resume['others'] = extras.length ? extras.map(x => `${x.category}: ${x.detail}`).join('\n') : '';
  
  const res = await chrome.runtime.sendMessage({ type: 'save_resume', resume }).catch(() => null);
  if (res?.ok) {
    setStatus('Saved');
  } else {
    setStatus('Save failed');
  }
});

openOptions.addEventListener('click', async (e) => {
  e.preventDefault();
  await chrome.runtime.openOptionsPage();
});

function setStatus(text) {
  statusEl.textContent = text;
  setTimeout(() => { statusEl.textContent = ''; }, 2000);
}

loadResume();
loadLastOutput();

// ---------------------- extras UI logic ----------------------

function renderExtras(items) {
  extrasContainer.innerHTML = '';
  items.forEach(addExtraRow);
}

function addExtraRow(item = { category: '', detail: '' }) {
  const row = document.createElement('div');
  row.className = 'extra-row';
  row.innerHTML = `
    <div class="top-line">
      <input class="extra-category" type="text" placeholder="context type" value="${escapeAttr(item.category)}">
      <button type="button" class="remove" title="Delete" aria-label="Delete">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M3 2h10v2H3V2Zm2 2v10h6V4H5Zm1-2h4v2H6V2Zm-2 3h8v9H4V5Z"/>
        </svg>
      </button>
    </div>
    <div class="bottom-line">
      <textarea class="extra-detail" placeholder="Describe who you are, your aesthetic, values; or list responsibilities, projects, papers...">${(item.detail || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
    </div>
  `;
  row.querySelector('.remove').addEventListener('click', () => {
    row.remove();
  });
  extrasContainer.appendChild(row);
}

addExtraBtn?.addEventListener('click', () => {
  setExtrasError('');
  addExtraRow();
});

function collectExtras() {
  const rows = Array.from(extrasContainer.querySelectorAll('.extra-row'));
  return rows.map(r => ({
    category: (r.querySelector('.extra-category')?.value || '').trim(),
    detail: (r.querySelector('.extra-detail')?.value || '').trim()
  })).filter(x => x.category || x.detail); // 允许空行被自动忽略
}

function setExtrasError(text) {
  extrasErrorEl.textContent = text || '';
}

function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getDefaultExtras() {
  return [
    {
      category: 'Value (My value)',
      detail: ''
    },
    {
      category: 'Portfolio',
      detail: ''
    }
  ];
}

async function loadLastOutput() {
  try {
    // 1) Read extension storage directly (session -> local)
    const sess = await chrome.storage.session.get('lastOutput').catch(() => ({}));
    if (sess && sess.lastOutput && typeof sess.lastOutput.text === 'string') {
      lastOutputEl.textContent = sess.lastOutput.text || '';
      return;
    }
    const loc = await chrome.storage.local.get('lastOutput').catch(() => ({}));
    if (loc && loc.lastOutput && typeof loc.lastOutput.text === 'string') {
      lastOutputEl.textContent = loc.lastOutput.text || '';
      return;
    }
    // 2) Fallback: ask active page and background via messaging
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const fromPage = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: 'get_last_output' }).catch(() => null) : null;
    if (fromPage?.ok && typeof fromPage.text === 'string') {
      lastOutputEl.textContent = fromPage.text || '';
      return;
    }
    const fromBg = await chrome.runtime.sendMessage({ type: 'get_last_output' }).catch(() => null);
    if (fromBg?.ok && fromBg.data && typeof fromBg.data.text === 'string') {
      lastOutputEl.textContent = fromBg.data.text || '';
      return;
    }
    lastOutputEl.textContent = '';
  } catch (_) {
    lastOutputEl.textContent = '';
  }
}

copyLastBtn?.addEventListener('click', async () => {
  const text = lastOutputEl?.textContent || '';
  if (!text) { setStatus('Nothing to copy'); return; }
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied');
  } catch (_) {
    // Fallback
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(lastOutputEl);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      setStatus('Copied');
    } catch (_) { setStatus('Copy failed'); }
  }
});

refreshLastBtn?.addEventListener('click', async () => {
  await loadLastOutput();
  setStatus('Refreshed');
});

// Live update when background finishes a generation
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'last_output_updated' && lastOutputEl) {
    const text = message?.data?.text || '';
    lastOutputEl.textContent = text;
    setStatus('Updated');
  }
});

// Also react to storage updates as a safety net
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((changes?.lastOutput || changes?.['lastOutput']) && lastOutputEl) {
      const v = (changes.lastOutput || changes['lastOutput']).newValue;
      if (v && typeof v.text === 'string') {
        lastOutputEl.textContent = v.text;
        setStatus('Updated');
      }
    }
  });
} catch (_) {}

// Readonly now; allow explicit Clear
clearLastBtn?.addEventListener('click', async () => {
  lastOutputEl.textContent = '';
  try {
    await chrome.storage.session.remove('lastOutput');
    await chrome.storage.local.remove('lastOutput');
    await chrome.runtime.sendMessage({ type: 'set_last_output', text: '' }).catch(() => null);
    setStatus('Cleared');
  } catch (_) {
    setStatus('Clear failed');
  }
});

// ---------------------- sub scramble effect (动画效果移到子标题) ----------------------
(function initSubScramble() {
  const subEl = document.querySelector('.sub');
  if (!subEl) return;

  const originalText = subEl.textContent || '';
  const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let triggerTimer = null;
  let tickTimer = null;
  let isScrambling = false;

  function randomChar() {
    return pool[Math.floor(Math.random() * pool.length)] || ' ';
  }

  function startScramble() {
    if (isScrambling) return;
    isScrambling = true;
    const startAt = Date.now();
    // fast updates during 300ms, changed to 1 second total animation
    tickTimer = setInterval(() => {
      const now = Date.now();
      if (now - startAt >= 1000) { // 动画总时长 1 秒
        stopScramble();
        return;
      }
      const chars = originalText.split('').map(ch => (ch === ' ' ? ' ' : randomChar()));
      subEl.textContent = chars.join('');
    }, 30);
  }

  function stopScramble() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    subEl.textContent = originalText;
    isScrambling = false;
  }

  // trigger every 1s
  triggerTimer = setInterval(startScramble, 1000); // 触发间隔改为 1 秒

  // cleanup on unload
  window.addEventListener('beforeunload', () => {
    if (triggerTimer) clearInterval(triggerTimer);
    if (tickTimer) clearInterval(tickTimer);
  });
})();
