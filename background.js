const STORAGE_KEYS = {
  resume: 'userResume',
  api: 'apiConfig',
  last: 'lastOutput'
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'resume_fill',
    title: 'Autofill it with my context',
    contexts: ['editable', 'selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'resume_fill' && tab && tab.id) {
    const frameId = typeof info.frameId === 'number' ? info.frameId : undefined;
    await sendMessageToTabWithFallback(tab.id, { 
      type: 'trigger_fill_for_context',
      selectionText: info.selectionText || null
    }, frameId);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle_select_mode') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      await sendMessageToTabWithFallback(tab.id, { type: 'toggle_select_mode' });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'get_resume') {
      const data = await chrome.storage.local.get([STORAGE_KEYS.resume]);
      sendResponse({ ok: true, resume: data[STORAGE_KEYS.resume] || '' });
      return;
    }

    if (message?.type === 'save_resume') {
      await chrome.storage.local.set({ [STORAGE_KEYS.resume]: message.resume || '' });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'get_api_config') {
      const data = await chrome.storage.local.get([STORAGE_KEYS.api]);
      sendResponse({ ok: true, config: data[STORAGE_KEYS.api] || {} });
      return;
    }

    if (message?.type === 'set_last_output') {
      try {
        const payload = {
          text: String(message.text || ''),
          pageContext: message.pageContext || {},
          at: Date.now()
        };
        await chrome.storage.session.set({ [STORAGE_KEYS.last]: payload }).catch(() => {});
        await chrome.storage.local.set({ [STORAGE_KEYS.last]: payload }).catch(() => {});
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }
    if (message?.type === 'get_last_output') {
      // Prefer ephemeral session storage; fallback to local if absent
      const sess = await chrome.storage.session.get([STORAGE_KEYS.last]).catch(() => ({}));
      if (sess && sess[STORAGE_KEYS.last]) {
        sendResponse({ ok: true, data: sess[STORAGE_KEYS.last] });
        return;
      }
      const data = await chrome.storage.local.get([STORAGE_KEYS.last]).catch(() => ({}));
      sendResponse({ ok: true, data: data?.[STORAGE_KEYS.last] || null });
      return;
    }


    if (message?.type === 'save_api_config') {
      await chrome.storage.local.set({ [STORAGE_KEYS.api]: message.config || {} });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'generate_fill') {
      try {
        const [{ [STORAGE_KEYS.resume]: resume }, { [STORAGE_KEYS.api]: apiConfig }] = await Promise.all([
          chrome.storage.local.get([STORAGE_KEYS.resume]),
          chrome.storage.local.get([STORAGE_KEYS.api])
        ]);

        if (!apiConfig?.apiKey || !apiConfig?.model) {
          sendResponse({ ok: false, error: 'Set API Key and model in Settings' });
          return;
        }
        
        const provider = inferProvider(apiConfig);
        let completion = '';

        if (provider === 'gemini') {
          const inferredGeminiUrl = apiConfig.baseUrl && apiConfig.baseUrl.trim()
            ? apiConfig.baseUrl.trim()
            : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(apiConfig.model)}:generateContent?key=${encodeURIComponent(apiConfig.apiKey)}`;
          completion = await callGoogleGeminiAPI({
            apiKey: apiConfig.apiKey,
            model: apiConfig.model,
            question: message.question || '',
            resume: resume || {},
            pageContext: message.pageContext || {},
            baseUrl: inferredGeminiUrl
          });
        } else { // 'openai' and others
          const defaultOpenAI = 'https://api.openai.com/v1/responses';
          const base = (apiConfig?.baseUrl || '').trim() || defaultOpenAI;
          completion = await callOpenAICompatibleAPI({
            baseUrl: base,
            apiKey: apiConfig.apiKey,
            model: apiConfig.model,
            question: message.question || '',
            resume: resume || {},
            pageContext: message.pageContext || {},
            org: apiConfig.org || '',
            project: apiConfig.project || ''
          });
        }

        // Check if completion is empty or invalid
        const trimmedCompletion = (completion || '').trim();
        if (!trimmedCompletion) {
          sendResponse({ ok: false, error: 'Empty response from model. Please check your API key and model, or try again.' });
          return;
        }

        // persist last output for popup preview/copy
        try {
          const payload = {
            text: trimmedCompletion,
            question: message.question || '',
            pageContext: message.pageContext || {},
            at: Date.now()
          };
          await chrome.storage.session.set({ [STORAGE_KEYS.last]: payload }).catch(() => {});
          await chrome.storage.local.set({ [STORAGE_KEYS.last]: payload }).catch(() => {});
          // Proactively notify any open popup to refresh its Last output view
          try { chrome.runtime.sendMessage({ type: 'last_output_updated', data: payload }); } catch (_) {}
        } catch (_) {}

        sendResponse({ ok: true, text: trimmedCompletion });
        return;
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
        return;
      }
    }
  })();
  return true; // keep message channel open for async
});

async function callOpenAICompatibleAPI({ baseUrl, apiKey, model, question, resume, pageContext, org, project }) {
  const { system, userContext } = buildCommonPromptParts(question, resume, pageContext);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: userContext }
  ];

  const endpointUrl = String(baseUrl || '').trim();
  const kind = determineEndpointKind(endpointUrl);
  if (kind === 'unknown') {
    throw new Error('Base URL is not a supported endpoint. Use full /v1/chat/completions or /v1/responses');
  }

  // 遵循官方示例：Responses 用最简 input 字段；Chat 用 messages
  const body = kind === 'responses'
    ? { model, input: userContext, temperature: 0.7, max_output_tokens: 2048 }
    : { model, messages, temperature: 0.7, max_tokens: 2048 };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  if (org) headers['OpenAI-Organization'] = org;
  if (project) headers['OpenAI-Project'] = project;

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }).catch(() => {
    throw new Error('Network error. Check API URL or network');
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 401) throw new Error('Invalid or expired API Key (OpenAI)');
    if (status === 404) throw new Error('Invalid model or API URL (OpenAI)');
    if (status === 429) throw new Error('Rate limit or insufficient balance (OpenAI)');
    if (status === 400) {
      const text = await response.text().catch(() => '');
      // 检查是否是输入 token 过大
      if (text.includes('maximum context length') || text.includes('token') || text.includes('too long')) {
        throw new Error(`Input too long (OpenAI). Your profile or context may be too large. Try reducing your profile content.`);
      }
      throw new Error(`API error (code: ${status}) ${text}`);
    }
    const text = await response.text().catch(() => '');
    throw new Error(`API error (code: ${status}) ${text}`);
  }
  
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`Failed to parse API response: ${String(err && err.message ? err.message : err)}`);
  }
  
  if (kind === 'responses') {
    const result = (data && (data.output_text || '').trim())
      || (data?.output?.[0]?.content?.[0]?.text || '').trim()
      || (data?.choices?.[0]?.message?.content || '').trim()
      || '';
    if (!result) {
      throw new Error('Empty or invalid response format from OpenAI API. Please check your model and API key.');
    }
    return result;
  }
  
  const result = data?.choices?.[0]?.message?.content?.trim() || '';
  if (!result) {
    throw new Error('Empty or invalid response format from OpenAI API. Please check your model and API key.');
  }
  return result;
}

function determineEndpointKind(url) {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('/v1/responses')) return 'responses';
  if (lower.includes('/v1/chat/completions')) return 'chat';
  // 兼容一些网关：允许无 /v1 的路径
  if (/(^|\/)responses(\/?$|\?)/.test(lower)) return 'responses';
  if (/(^|\/)chat\/completions(\/?$|\?)/.test(lower)) return 'chat';
  return 'unknown';
}

// 推断供应商：优先根据 baseUrl，其次根据 model 名称
function inferProvider(cfg) {
  const base = String(cfg?.baseUrl || '').toLowerCase();
  const model = String(cfg?.model || '').toLowerCase();
  if (base.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (base.includes('api.openai.com') || base.includes('chat/completions') || base.includes('responses')) return 'openai';
  if (model.startsWith('gemini') || model.includes('gemini-') || model.includes('models/gemini')) return 'gemini';
  return 'openai';
}

function buildResponsesBody({ model, system, userContext }) {
  return {
    model,
    instructions: system,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: userContext }
        ]
      }
    ],
    temperature: 0.7,
    max_output_tokens: 1024
  };
}

async function callGoogleGeminiAPI({ apiKey, model, question, resume, pageContext, baseUrl }) {
  const { systemInstruction, contents } = buildGeminiPayload({ question, resume, pageContext });
  const endpoint = String(baseUrl || '').trim();
  if (!endpoint) throw new Error('Base URL is required (Gemini)');

  const headers = { 'Content-Type': 'application/json' };
  // Prefer header for API Key if URL未携带 key 参数
  if (!/[?&]key=/.test(endpoint) && apiKey) headers['x-goog-api-key'] = apiKey;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      systemInstruction,
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192  // 增加到 8192，避免输出被截断
      }
    })
  }).catch(() => {
    throw new Error('Network error. Check your network');
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const errorMsg = data?.error?.message || `HTTP Error ${response.status}`;
    if (response.status === 400) {
      // 400 错误可能是 maxOutputTokens 不支持或输入 token 过大
      if (errorMsg.includes('maxOutputTokens') || errorMsg.includes('token')) {
        throw new Error(`Invalid request (Gemini): ${errorMsg}. The model may not support maxOutputTokens: 4096. Try a different model or reduce your profile content.`);
      }
      throw new Error(`Invalid request. Check model or API Key (Gemini): ${errorMsg}`);
    }
    if (response.status === 429) throw new Error(`Rate limit or insufficient balance (Gemini)`);
    throw new Error(`API error (Gemini): ${errorMsg}`);
  }
  
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`Failed to parse Gemini API response: ${String(err && err.message ? err.message : err)}`);
  }
  
  // 尝试多种可能的响应格式路径
  let result = '';
  if (data?.candidates && Array.isArray(data.candidates) && data.candidates.length > 0) {
    const candidate = data.candidates[0];
    
    // 检查 finishReason
    const finishReason = candidate.finishReason;
    
    // MAX_TOKENS 表示内容被截断，但可能有部分文本，应该尝试提取
    if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
      throw new Error(`Gemini API blocked the response (finishReason: ${finishReason}). Try adjusting your prompt or profile.`);
    }
    
    // 标准格式: candidates[0].content.parts[0].text
    if (candidate?.content?.parts && Array.isArray(candidate.content.parts) && candidate.content.parts.length > 0) {
      result = candidate.content.parts[0]?.text?.trim() || '';
    }
    // 如果没有 parts，尝试直接从 content 获取
    if (!result && candidate?.content?.text) {
      result = candidate.content.text.trim();
    }
    // 备用格式: candidates[0].text
    if (!result && candidate?.text) {
      result = candidate.text.trim();
    }
    
    // 如果是 MAX_TOKENS 但没有文本，说明响应格式异常或文本被完全截断
    if (!result && finishReason === 'MAX_TOKENS') {
      // 检查是否有 parts 但为空
      const hasEmptyParts = candidate?.content?.parts && Array.isArray(candidate.content.parts) && candidate.content.parts.length === 0;
      const hasContentButNoParts = candidate?.content && !candidate.content.parts;
      
      // 提供更详细的错误信息，包含 usageMetadata
      const usageInfo = data?.usageMetadata ? ` (prompt: ${data.usageMetadata.promptTokenCount}, total: ${data.usageMetadata.totalTokenCount})` : '';
      
      if (hasEmptyParts || hasContentButNoParts) {
        throw new Error(`Response was truncated due to token limit and no text was generated${usageInfo}. Try reducing your profile content or field context length, or the model may have a lower maxOutputTokens limit.`);
      } else {
        throw new Error(`Response was truncated due to token limit${usageInfo}. Try reducing your profile content or field context length.`);
      }
    }
    
    // 如果 finishReason 是 MAX_TOKENS 但有文本，警告但返回结果
    if (result && finishReason === 'MAX_TOKENS') {
      // 静默处理，返回已生成的文本（即使被截断）
      // 用户可以自己判断是否需要调整
    }
  } else if (data?.candidates && Array.isArray(data.candidates) && data.candidates.length === 0) {
    throw new Error('Gemini API returned empty candidates array. This may be due to content safety filters. Try adjusting your prompt.');
  }
  
  // 如果没有找到结果，尝试其他可能的路径
  if (!result && data?.text) {
    result = data.text.trim();
  }
  
  if (!result) {
    // 提供更详细的错误信息，包含实际响应数据的摘要和 usageMetadata
    const usageInfo = data?.usageMetadata ? ` Usage: prompt=${data.usageMetadata.promptTokenCount}, total=${data.usageMetadata.totalTokenCount}` : '';
    const responseSummary = JSON.stringify(data).substring(0, 300);
    throw new Error(`Empty or invalid response format from Gemini API. Response: ${responseSummary}...${usageInfo}`);
  }
  return result;
}

function buildCommonPromptParts(question, resume, pageContext) {
  const { pageTitle, metaDesc, label, placeholder, ariaLabel, nameAttr, maxLength, maxChars, maxWords, nearbyText } = pageContext || {};
  
  // 优先使用新的 extras 格式，兼容旧的字段格式
  let resumeParts = '';
  if (Array.isArray(resume?.extras) && resume.extras.length > 0) {
    resumeParts = resume.extras.map(e => {
      const cat = e.category || '';
      const det = e.detail || '';
      return cat && det ? `${cat}:\n${det}` : '';
    }).filter(Boolean).join('\n\n');
  }
  // 如果没有 extras，尝试使用旧的字段格式
  if (!resumeParts) {
    const oldParts = [
      resume?.['work-exp'] ? `Work Experience:\n${resume['work-exp']}` : '',
      resume?.['project-exp'] ? `Projects:\n${resume['project-exp']}` : '',
      resume?.['education'] ? `Education:\n${resume['education']}` : '',
      resume?.['skills'] ? `Skills:\n${resume['skills']}` : '',
      resume?.['others'] ? `Other:\n${resume['others']}` : '',
    ].filter(Boolean);
    resumeParts = oldParts.join('\n\n');
  }
  // 如果都没有，使用 others 字段作为后备
  if (!resumeParts && resume?.['others']) {
    resumeParts = resume['others'];
  }

  // 保护：如果个人档案过大，限制长度以避免输入 token 超出限制
  // 估算：1 中文字符 ≈ 1.5 token，1 英文单词 ≈ 1.3 token
  // 保留足够空间给其他上下文（预计约 1000 tokens），总共限制在约 25000 字符
  const MAX_RESUME_CHARS = 25000;
  if (resumeParts.length > MAX_RESUME_CHARS) {
    resumeParts = resumeParts.slice(0, MAX_RESUME_CHARS - 3) + '...\n[档案内容过长，已截断]';
  }

  const stylePreference = resume['style-preference'] || 'Professional, concise';
  const constraints = [];
  const charLimit = Number(maxChars || maxLength) || null;
  if (charLimit) constraints.push(`Keep total length under ${charLimit} characters.`);
  if (maxWords) constraints.push(`Keep total length under ${maxWords} words.`);
  if (stylePreference) constraints.push(`Follow style: ${stylePreference}.`);

  const system = [
    "You are an autofill assistant. Write accurate, concise text based on the user's resume and field context.",
    'Use only the provided resume. Do not fabricate experience.',
    'Output text ready to paste into the field. No headings or explanations.'
  ].join('\n');

  const userContext = [
    'I am filling a web form. Based on my resume, generate content for the field below.',
    `---`,
    `Page title: ${pageTitle || 'N/A'}`,
    metaDesc ? `Page description: ${truncate(metaDesc, 200)}` : null,
    `Field info:`,
    `  - Question/Label: ${truncate(question || 'N/A', 500)}`,
    `  - Placeholder: ${truncate(placeholder || 'N/A', 200)}`,
    `  - Nearby text: ${truncate(nearbyText || '', 1000)}`,
    `---`,
    `Constraints:`,
    ...constraints.filter(Boolean).map(c => `  - ${c}`),
    `---`,
    'My resume (only source of truth):',
    resumeParts || 'N/A',
    `---`,
    'Generate the fill text:'
  ].filter(Boolean).join('\n');
  
  return { system, userContext };
}

function buildOpenAIMessages({ question, resume, pageContext }) {
  const { system, userContext } = buildCommonPromptParts(question, resume, pageContext);
  return [
    { role: 'system', content: system },
    { role: 'user', content: userContext }
  ];
}

function buildGeminiPayload({ question, resume, pageContext }) {
  const { system, userContext } = buildCommonPromptParts(question, resume, pageContext);
  // 根据官方文档：https://ai.google.dev/gemini-api/docs?hl=zh-cn
  // 标准格式：contents 数组包含 parts，systemInstruction 可选
  return {
    systemInstruction: {
      parts: [{ text: system }]
    },
    contents: [
      {
        parts: [{ text: userContext }]
      }
    ]
  };
}

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

// 尝试向标签页发送消息；若失败（内容脚本不存在），则注入并重试
async function sendMessageToTabWithFallback(tabId, message, frameId) {
  try {
    if (typeof frameId === 'number') {
      return await chrome.tabs.sendMessage(tabId, message, { frameId });
    }
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    try {
      // Inject into specific frame if known; otherwise inject into all frames
      const target = typeof frameId === 'number'
        ? { tabId, frameIds: [frameId] }
        : { tabId, allFrames: true };
      await chrome.scripting.executeScript({ target, files: ['content-script.js'] });
      if (typeof frameId === 'number') {
        return await chrome.tabs.sendMessage(tabId, message, { frameId });
      }
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err2) {
      // 无法注入（如 chrome://、扩展商店等页面），静默失败以避免未捕获异常
      return null;
    }
  }
}
