let selectModeEnabled = false;
let hoverHighlightEl = null; // deprecated overlay (kept for compatibility)
let lastHoverTarget = null;
let lastContextMenuTarget = null;

// 全局记录最近一次右键的目标元素（不依赖选择模式）
document.addEventListener('contextmenu', onContextMenu, true);

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if (el.isContentEditable) return true;
  return false;
}

function enableSelectMode() {
  if (selectModeEnabled) return;
  selectModeEnabled = true;
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClickCapture, true);
  ensureHighlightEl();
}

function disableSelectMode() {
  if (!selectModeEnabled) return;
  selectModeEnabled = false;
  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('mouseout', onMouseOut, true);
  document.removeEventListener('click', onClickCapture, true);
  removeHighlightEl();
}

function ensureHighlightEl() { /* no-op: use class highlight */ }

function removeHighlightEl() { /* no-op: class highlight handles */ }

function onMouseOver(e) {
  const target = e.target;
  if (!isEditable(target)) {
    if (lastHoverTarget) lastHoverTarget.classList.remove('ai-ext-highlight');
    lastHoverTarget = null;
    return;
  }
  if (lastHoverTarget && lastHoverTarget !== target) {
    lastHoverTarget.classList.remove('ai-ext-highlight');
  }
  lastHoverTarget = target;
  target.classList.add('ai-ext-highlight');
}

function onMouseOut(e) {
  const toEl = e.relatedTarget;
  if (lastHoverTarget && (!toEl || toEl !== lastHoverTarget)) {
    lastHoverTarget.classList.remove('ai-ext-highlight');
  }
}

function onClickCapture(e) {
  if (!selectModeEnabled) return;
  const target = e.target;
  if (!isEditable(target)) return;
  e.preventDefault();
  e.stopPropagation();
  disableSelectMode();
  handleGenerateForElement(target);
}

function onContextMenu(e) {
  lastContextMenuTarget = e.target;
}

function highlightElement(el) { /* obsolete with class-based highlight */ }

async function handleGenerateForElement(el) {
  const { question, pageContext } = extractQuestionAndContext(el);
  const loadingToast = toast('Generating...', 0); // show loading toast indefinitely
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'generate_fill',
      question,
      pageContext
    }).catch(err => {
      // 如果 sendMessage 本身失败（如扩展未加载），返回错误响应
      return { ok: false, error: `Communication error: ${String(err && err.message ? err.message : err)}` };
    });

    loadingToast.remove(); // remove loading toast

    if (!response) {
      toast('Generation failed: No response', 4000);
      return;
    }

    if (response.ok && response.text && response.text.trim()) {
      applyTextToElement(el, response.text);
      try { sessionStorage.setItem('ai_second_me_last_output', response.text); } catch (_) {}
      try { await chrome.runtime.sendMessage({ type: 'set_last_output', text: response.text, pageContext }); } catch (_) {}
      toast('Filled', 1800);
    } else {
      // 详细错误信息：优先显示 response.error，否则根据情况判断
      let errorMsg = 'Unknown error';
      if (response.error) {
        errorMsg = response.error;
      } else if (response.ok === false) {
        errorMsg = 'Request failed';
      } else if (response.text === '' || (response.text && !response.text.trim())) {
        errorMsg = 'Empty response from model';
      } else if (!response.ok) {
        errorMsg = 'Request failed';
      }
      toast(`Generation failed: ${errorMsg}`, 5000);
    }
  } catch (err) {
    loadingToast.remove(); // remove loading toast on error
    toast(`Generation error: ${String(err && err.message ? err.message : err)}`, 5000);
  }
}

function extractQuestionAndContext(el) {
  const labelText = findLabelText(el) || '';
  const placeholder = el.getAttribute?.('placeholder') || '';
  const ariaLabel = el.getAttribute?.('aria-label') || '';
  const nameAttr = el.getAttribute?.('name') || '';
  const maxLength = el.getAttribute?.('maxlength') || null;
  const nearbyText = findNearbyText(el, 800);
  const { maxChars, maxWords } = detectLengthHints([labelText, placeholder, nearbyText].join(' \n '));
  const pageTitle = document.title || '';
  const metaDesc = (document.querySelector('meta[name="description"]')?.getAttribute('content') || '').trim();

  const question = labelText || ariaLabel || placeholder || nameAttr || 'Form field';
  return {
    question,
    pageContext: { pageTitle, metaDesc, label: labelText, placeholder, ariaLabel, nameAttr, maxLength, maxChars, maxWords, nearbyText }
  };
}

function findLabelText(el) {
  const id = el.id;
  if (id) {
    const byFor = document.querySelector(`label[for="${cssEscape(id)}"]`);
    if (byFor && byFor.textContent) return byFor.textContent.trim();
  }
  let p = el.parentElement;
  while (p) {
    if (p.tagName && p.tagName.toLowerCase() === 'label') {
      return p.textContent?.trim() || '';
    }
    p = p.parentElement;
  }
  return '';
}

function findNearbyText(el, maxLen) {
  const container = el.closest('form') || el.closest('[role="group"]') || el.parentElement;
  if (!container) return '';
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      const text = node.nodeValue.trim();
      if (!text) return NodeFilter.FILTER_REJECT;
      if (text.length < 2) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const parts = [];
  while (parts.join(' ').length < (maxLen || 600)) {
    const n = walker.nextNode();
    if (!n) break;
    parts.push(n.nodeValue.trim());
  }
  return parts.join(' ').slice(0, maxLen || 600);
}

function applyTextToElement(el, text) {
  const tag = el.tagName?.toLowerCase();
  // Inputs / textareas: prefer selection-aware and native setter for controlled components
  if (tag === 'input' || tag === 'textarea') {
    try {
      el.focus();
      if (typeof el.setRangeText === 'function') {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? el.value.length;
        el.setRangeText(text, start, end, 'end');
      } else {
        setNativeValue(el, text);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if ((el.value || '').toString() !== text) {
        // Fallbacks
        try {
          el.select?.();
          document.execCommand('insertText', false, text);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_) {
          setNativeValue(el, text);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } catch (_) {}
    return;
  }
  // contentEditable
  if (el.isContentEditable) {
    try {
      el.focus();
      const ok = document.execCommand('insertText', false, text);
      if (!ok) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        sel?.removeAllRanges?.();
        sel?.addRange?.(range);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) {
      try {
        el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (_) {}
    }
    return;
  }
}

// Native value setter for React/Vue controlled fields
function setNativeValue(el, value) {
  try {
    const tag = (el.tagName || '').toUpperCase();
    const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && typeof desc.set === 'function') {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
  } catch (_) {
    try { el.value = value; } catch (_) {}
  }
}

function toast(msg, duration = 2200) {
  const t = document.createElement('div');
  t.className = 'ai-ext-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  
  if (duration > 0) {
    setTimeout(() => t.remove(), duration);
  }
  
  return t; // Return the element so it can be removed manually
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'toggle_select_mode') {
    if (selectModeEnabled) {
      disableSelectMode();
      toast('Select mode off');
    } else {
      enableSelectMode();
      toast('Select mode on: hover an editable area and click');
    }
    sendResponse({ ok: true, enabled: selectModeEnabled });
    return;
  }
  if (message?.type === 'trigger_fill_for_focused') {
    const el = document.activeElement;
    if (isEditable(el)) {
      handleGenerateForElement(el);
      sendResponse({ ok: true });
    } else {
      toast('Place the cursor in a field first');
      sendResponse({ ok: false });
    }
    return;
  }
  if (message?.type === 'trigger_fill_for_context') {
    const questionEl = lastContextMenuTarget || null;
    const selectionText = message.selectionText || null;
    // Prefer the element under the contextmenu as target, if editable
    let targetEl = isEditable(questionEl) ? questionEl : (isEditable(document.activeElement) ? document.activeElement : findNearestEditableFrom(questionEl));

    if (!isEditable(targetEl)) {
      toast('Click a field to complete generation');
      const once = (e) => {
        const t = e.target;
        if (!isEditable(t)) return;
        document.removeEventListener('click', once, true);
        handleGenerateForQuestionAndTarget(t, questionEl, selectionText);
      };
      document.addEventListener('click', once, true);
      sendResponse({ ok: true, awaitingTarget: true });
      return;
    }

    handleGenerateForQuestionAndTarget(targetEl, questionEl, selectionText);
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === 'get_last_output') {
    let text = '';
    try { text = sessionStorage.getItem('ai_second_me_last_output') || ''; } catch (_) {}
    sendResponse({ ok: true, text });
    return;
  }
});

function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function findNearestEditableFrom(el) {
  if (!el) return null;
  const container = el.closest('form') || el.closest('[role="group"], [data-form], [data-field]') || el.parentElement;
  const selector = 'input, textarea, [contenteditable=""], [contenteditable="true"]';
  if (container) {
    const found = container.querySelector(selector);
    if (isEditable(found)) return found;
  }
  let p = el.parentElement;
  while (p && p !== document.body) {
    const candidate = p.querySelector(selector);
    if (isEditable(candidate)) return candidate;
    p = p.parentElement;
  }
  const any = document.querySelector(selector);
  return isEditable(any) ? any : null;
}

function handleGenerateForQuestionAndTarget(targetEl, questionEl, selectionText) {
  const { question, pageContext } = extractQuestionAndContextFromQuestionEl(questionEl, targetEl, selectionText);
  generateAndFill(targetEl, question, pageContext);
}

function generateAndFill(targetEl, question, pageContext) {
  const loadingToast = toast('Generating...', 0);
  (async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'generate_fill',
        question,
        pageContext
      }).catch(err => {
        return { ok: false, error: `Communication error: ${String(err && err.message ? err.message : err)}` };
      });
      loadingToast.remove();
      
      if (!response) {
        toast('Generation failed: No response', 4000);
        return;
      }

      if (response.ok && response.text && response.text.trim()) {
        applyTextToElement(targetEl, response.text);
        try { sessionStorage.setItem('ai_second_me_last_output', response.text); } catch (_) {}
        try { await chrome.runtime.sendMessage({ type: 'set_last_output', text: response.text, pageContext }); } catch (_) {}
        toast('Filled', 1800);
      } else {
        // 详细错误信息：优先显示 response.error，否则根据情况判断
        let errorMsg = 'Unknown error';
        if (response.error) {
          errorMsg = response.error;
        } else if (response.ok === false) {
          errorMsg = 'Request failed';
        } else if (response.text === '' || (response.text && !response.text.trim())) {
          errorMsg = 'Empty response from model';
        } else if (!response.ok) {
          errorMsg = 'Request failed';
        }
        toast(`Generation failed: ${errorMsg}`, 5000);
      }
    } catch (err) {
      loadingToast.remove();
      toast(`Generation error: ${String(err && err.message ? err.message : err)}`, 5000);
    }
  })();
}

function extractQuestionAndContextFromQuestionEl(questionEl, targetEl, selectionText) {
  const pageTitle = document.title || '';
  // 优先使用用户选中的文本作为问题上下文（但需要验证非空且有意义）
  const isValidSelection = selectionText && typeof selectionText === 'string' && selectionText.trim().length > 0;
  const questionText = isValidSelection ? selectionText.trim().slice(0, 2000) : (questionEl?.textContent || '').trim() || 'Form question';
  const placeholder = targetEl?.getAttribute?.('placeholder') || '';
  const ariaLabel = targetEl?.getAttribute?.('aria-label') || '';
  const nameAttr = targetEl?.getAttribute?.('name') || '';
  const maxLength = targetEl?.getAttribute?.('maxlength') || null;
  // 如果用户选中了有效文本，优先使用选中文本；否则提取附近文本
  const nearbyText = isValidSelection ? selectionText.trim().slice(0, 2000) : [
    findNearbyText(questionEl || targetEl, 500),
    findNearbyText(targetEl, 300)
  ].filter(Boolean).join(' ').slice(0, 1000);
  const { maxChars, maxWords } = detectLengthHints([questionText, placeholder, nearbyText].join(' \n '));
  const metaDesc = (document.querySelector('meta[name="description"]')?.getAttribute('content') || '').trim();

  return {
    question: questionText,
    pageContext: { pageTitle, metaDesc, label: '', placeholder, ariaLabel, nameAttr, maxLength, maxChars, maxWords, nearbyText }
  };
}

// 解析长度提示（中英混合）：返回最大字符或词数
function detectLengthHints(text) {
  try {
    const s = String(text || '').toLowerCase();
    // words limit
    const wordPatterns = [
      /(\b|\D)(?:up to|at most|no more than|maximum|max)\s*(\d{2,5})\s*(?:words|word)(\b|\D)/i,
      /(\b|\D)(\d{2,5})\s*(?:words|word)\s*(?:limit|max|maximum)?(\b|\D)/i,
      /不超过\s*(\d{2,5})\s*词/,
      /(\d{2,5})\s*词\s*(?:以内|上限|限制|以内)?/
    ];
    for (const re of wordPatterns) {
      const m = s.match(re);
      if (m) return { maxChars: null, maxWords: Number(m[2] || m[1]) || null };
    }
    // characters limit
    const charPatterns = [
      /(\b|\D)(?:up to|at most|no more than|maximum|max)\s*(\d{2,6})\s*(?:characters|character|chars)(\b|\D)/i,
      /(\b|\D)(\d{2,6})\s*(?:characters|character|chars)\s*(?:limit|max|maximum)?(\b|\D)/i,
      /不超过\s*(\d{2,6})\s*(?:字|字符)/,
      /(\d{2,6})\s*(?:字|字符)\s*(?:以内|上限|限制|以内)?/
    ];
    for (const re of charPatterns) {
      const m = s.match(re);
      if (m) return { maxChars: Number(m[2] || m[1]) || null, maxWords: null };
    }
    return { maxChars: null, maxWords: null };
  } catch (_) {
    return { maxChars: null, maxWords: null };
  }
}
