// ==================== 配置常量 ====================

const DEFAULT_SETTINGS = {
    autoHideDialog: true,
    base_url: 'https://api.freewife.online',
    api_key: '',
    model: 'deepseek-v3',
    enableContext: true,
    stream: true,
    max_tokens: 2048,
    temperature: 0.6
};

// ==================== 工具函数 ====================

// 显示弹窗提示
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    
    // 设置消息内容和类型
    toastMessage.textContent = message;
    toast.className = `toast ${type}`;
    
    // 显示弹窗
    toast.classList.add('show');
    
    // 自动隐藏弹窗（除了错误消息）
    if (type !== 'error') {
        setTimeout(() => {
            hideToast();
        }, type === 'warning' ? 5000 : 3000);
    }
}

// 隐藏弹窗提示
function hideToast() {
    const toast = document.getElementById('toast');
    toast.classList.remove('show');
}

// 兼容旧的showStatus函数名
function showStatus(message, type = 'success') {
    showToast(message, type);
}

// 处理API地址格式
function formatBaseUrl(base_url) {
    if (!base_url) return '';
    
    base_url = base_url.trim();
    
    if (base_url.endsWith('#')) {
        return base_url.slice(0, -1);
    }
    
    if (base_url.endsWith('/')) {
        return base_url + 'chat/completions';
    }
    
    return base_url + '/v1/chat/completions';
}

// 验证数值输入
function validateNumberInput(input, min, max, isFloat = false) {
    const value = isFloat ? parseFloat(input.value) : parseInt(input.value);
    
    if (isNaN(value) || value < min || value > max) {
        input.classList.add('invalid');
        showStatus(`请输入${min}~${max}之间的数值`, 'error');
        return false;
    }

    input.classList.remove('invalid');
    // 如果当前显示的是错误提示，则隐藏弹窗
    const toast = document.getElementById('toast');
    if (toast && toast.classList.contains('error')) {
        hideToast();
    }
    return true;
}

// 验证设置
function validateSettings(settings) {
    const isDefaultSettings = 
        settings.base_url === DEFAULT_SETTINGS.base_url &&
        settings.model === DEFAULT_SETTINGS.model;

    if (!settings.base_url.trim()) {
        throw new Error('请求URL是必填项');
    }
    if (!settings.model.trim()) {
        throw new Error('AI模型是必填项');
    }
    if (!settings.api_key.trim() && !isDefaultSettings) {
        throw new Error('API密钥是必填项');
    }
}

// 更新显示值
function updateDisplay(elementId, value) {
    const input = document.getElementById(`${elementId}_input`);
    if (input) input.value = value;
}

// ==================== API相关函数 ====================

// 测试API配置
async function testApiConfig(settings) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        
        if (!settings.api_key) {
            throw new Error('API密钥是必填项');
        }
        headers['Authorization'] = `Bearer ${settings.api_key}`;

        const requestBody = {
            model: settings.model,
            messages: [
                { role: "system", content: "你是一个帮助理解网页内容的AI助手。" },
                { role: "user", content: "这是一条测试消息，请回复：成功" }
            ],
            max_tokens: 10,
            temperature: 0.6,
            stream: settings.stream !== false
        };

        const response = await fetch(settings.base_url, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            try {
                const errorJson = JSON.parse(errorText);
                throw new Error(errorJson.error?.message || '请求失败');
            } catch (e) {
                throw new Error(`请求失败: ${errorText}`);
            }
        }

        // 处理流式响应
        if (requestBody.stream) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(5).trim();
                        if (data === '[DONE]') continue;
                        
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content || '';
                            if (content) fullResponse += content;
                        } catch (e) {
                            console.warn('解析流式响应失败:', e);
                        }
                    }
                }
            }
            
            if (!fullResponse) {
                throw new Error('无效的API响应格式');
            }
        } else {
            const data = await response.json();
            if (data.error || !data.choices?.[0]?.message) {
                throw new Error(data.error || '无效的API响应格式');
            }
        }
        
        return true;
    } catch (error) {
        throw new Error(`API测试失败: ${error.message}`);
    }
}

// ==================== UI更新函数 ====================

// 更新API地址预览
function updateApiHostPreview() {
    const baseUrlInput = document.getElementById('base_url');
    const apiHostPreview = document.getElementById('apiHostPreview');
    
    if (baseUrlInput && apiHostPreview) {
        const formattedUrl = formatBaseUrl(baseUrlInput.value);
        apiHostPreview.textContent = formattedUrl || '请输入API地址';
    }
}

// 初始化API设置界面
function initializeApiUI() {
    const elements = {
        base_url: document.getElementById('base_url'),
        api_key: document.getElementById('api_key'),
        model: document.getElementById('model'),
        system_prompt: document.getElementById('system_prompt')
    };

    // 设置占位符
    elements.api_key.placeholder = '请输入API密钥，例如 sk-xxxxxxxx';
    elements.base_url.placeholder = 'https://api.freewife.online';
    elements.model.placeholder = 'deepseek-v3';

}

// ==================== 设置管理函数 ====================

// 保存设置
async function saveSettings(testApi = false) {
    const baseUrlValue = document.getElementById('base_url').value.trim();
    const formattedBaseUrl = formatBaseUrl(baseUrlValue);
    
    const settings = {
        max_tokens: parseInt(document.getElementById('max_tokens_input').value),
        temperature: parseFloat(document.getElementById('temperature_input').value),
        api_key: document.getElementById('api_key').value.trim(),
        base_url: baseUrlValue || DEFAULT_SETTINGS.base_url,
        model: document.getElementById('model').value.trim(),
        autoHideDialog: document.getElementById('autoHideDialog')?.checked ?? true,
        enableContext: document.getElementById('enableContext')?.checked ?? true,
        stream: document.getElementById('stream')?.checked ?? true,

        system_prompt: document.getElementById('system_prompt')?.value || ''
    };

    settings.activeConfig = {
        api_key: settings.api_key,
        base_url: formattedBaseUrl,
        model: settings.model
    };

    try {
        if (testApi) {
            validateSettings({
                api_key: settings.api_key,
                base_url: settings.base_url,
                model: settings.model
            });

            showStatus('正在测试API配置...');
            await testApiConfig({
                api_key: settings.api_key,
                base_url: formattedBaseUrl,
                model: settings.model,
                stream: settings.stream
            });
        }

        await chrome.storage.sync.set(settings);
        showStatus(testApi ? '✅ API配置测试成功，设置已保存' : '✅ 设置已保存');
    } catch (error) {
        showStatus(error.message, 'error');
    }
}

// 加载设置
function loadOptions() {
    chrome.storage.sync.get({
        ...DEFAULT_SETTINGS,
        system_prompt: ''
    }, (items) => {
        
        // 1. autoHideDialog (界面设置)
        const autoHideDialog = document.getElementById('autoHideDialog');
        if (autoHideDialog) {
            autoHideDialog.checked = items.autoHideDialog;
        }
        
        // 2. API设置
        document.getElementById('base_url').value = items.base_url;
        document.getElementById('api_key').value = items.api_key;
        document.getElementById('model').value = items.model;
        document.getElementById('system_prompt').value = items.system_prompt;
        
        // 3. 对话设置
        const enableContext = document.getElementById('enableContext');
        if (enableContext) {
            enableContext.checked = items.enableContext;
        }
        
        const streamElement = document.getElementById('stream');
        if (streamElement) {
            streamElement.checked = items.stream;
        }
        
        // 4. 数值设置
        updateDisplay('max_tokens', items.max_tokens);
        updateDisplay('temperature', items.temperature);
        
        initializeApiUI();
        updateApiHostPreview();
    });
}

// 还原设置
async function resetOptions() {
    try {
        const defaultSystemPrompt = '你是一个帮助理解网页内容的AI助手，请使用MD格式回复。';
        
        await chrome.storage.sync.set({
            ...DEFAULT_SETTINGS,
            activeConfig: {
                api_key: DEFAULT_SETTINGS.api_key,
                base_url: DEFAULT_SETTINGS.base_url,
                model: DEFAULT_SETTINGS.model
            },
            system_prompt: defaultSystemPrompt
        });

        // 按HTML顺序更新UI
        
        // 1. 界面设置
        document.getElementById('autoHideDialog').checked = true;
        
        // 2. API设置
        document.getElementById('base_url').value = DEFAULT_SETTINGS.base_url;
        document.getElementById('api_key').value = DEFAULT_SETTINGS.api_key;
        document.getElementById('model').value = DEFAULT_SETTINGS.model;
        document.getElementById('system_prompt').value = defaultSystemPrompt;
        
        // 3. 对话设置
        document.getElementById('enableContext').checked = true;
        document.getElementById('stream').checked = true;
        
        // 4. 数值设置
        updateDisplay('max_tokens', DEFAULT_SETTINGS.max_tokens);
        updateDisplay('temperature', DEFAULT_SETTINGS.temperature);
        
        updateApiHostPreview();
        
        showStatus('已还原并保存默认设置。注意：使用前请先配置必要的API信息并测试。', 'warning');
    } catch (error) {
        showStatus('还原设置失败：' + error.message, 'error');
    }
}

// ==================== 事件监听器 ====================

document.addEventListener('DOMContentLoaded', () => {
    loadOptions();
    
    // 弹窗关闭按钮事件
    const toastClose = document.getElementById('toast-close');
    if (toastClose) {
        toastClose.addEventListener('click', hideToast);
    }

    // 按HTML元素出现顺序设置事件监听器
    
    // 1. autoHideDialog (界面设置)
    const autoHideDialog = document.getElementById('autoHideDialog');
    if (autoHideDialog) {
        autoHideDialog.addEventListener('change', () => {
            chrome.storage.sync.set({ autoHideDialog: autoHideDialog.checked });
        });
    }
    
    // 2. API设置事件
    // base_url
    const baseUrl = document.getElementById('base_url');
    if (baseUrl) {
        baseUrl.addEventListener('input', updateApiHostPreview);
    }
    
    // api_key 可视性切换
    const toggleApiKeyBtn = document.getElementById('toggle_api_key');
    const apiKeyInput = document.getElementById('api_key');
    if (toggleApiKeyBtn && apiKeyInput) {
        let isVisible = false;
        apiKeyInput.type = 'password';
        toggleApiKeyBtn.title = '点击显示';

        toggleApiKeyBtn.addEventListener('click', () => {
            isVisible = !isVisible;
            apiKeyInput.type = isVisible ? 'text' : 'password';
            toggleApiKeyBtn.innerHTML = `
                <span class="eye-icon">
                    ${isVisible ? `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                        </svg>
                    ` : `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 = 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                        </svg>
                    `}
                </span>
            `;
        });
    }
    
    // system_prompt (防抖处理)
    const systemPrompt = document.getElementById('system_prompt');
    if (systemPrompt) {
        let promptTimeout;
        systemPrompt.addEventListener('input', () => {
            if (promptTimeout) clearTimeout(promptTimeout);
            promptTimeout = setTimeout(() => {
                chrome.storage.sync.set({
                    system_prompt: systemPrompt.value
                });
            }, 1000);
        });
    }
    
    // 3. 对话设置事件
    // enableContext
    const enableContext = document.getElementById('enableContext');
    if (enableContext) {
        enableContext.addEventListener('change', () => {
            chrome.storage.sync.set({ enableContext: enableContext.checked });
        });
    }
    
    // stream
    const streamElement = document.getElementById('stream');
    if (streamElement) {
        streamElement.addEventListener('change', () => {
            chrome.storage.sync.set({ stream: streamElement.checked });
        });
    }
    
    // 4. 数值输入事件 (按HTML顺序)
    // max_tokens
    const maxTokensInput = document.getElementById('max_tokens_input');
    
    if (maxTokensInput) {
        maxTokensInput.addEventListener('input', (e) => {
            if (validateNumberInput(e.target, 1024, 8192)) {
                chrome.storage.sync.set({ max_tokens: parseInt(e.target.value) });
            }
        });
    }
    
    // temperature
    const temperatureInput = document.getElementById('temperature_input');
    
    if (temperatureInput) {
        temperatureInput.addEventListener('input', (e) => {
            // 限制输入格式
            if (!/^[0-9.]*$/.test(e.target.value)) {
                e.target.value = e.target.value.replace(/[^0-9.]/g, '');
            }
            const dots = e.target.value.match(/\./g);
            if (dots && dots.length > 1) {
                e.target.value = e.target.value.replace(/\.+/g, '.');
            }
            
            if (validateNumberInput(e.target, 0, 1, true)) {
                chrome.storage.sync.set({ temperature: parseFloat(e.target.value) });
            }
        });
    }
    
    // 5. 按钮事件 (按HTML顺序)
    // reset
    const resetBtn = document.getElementById('reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (confirm('确定要还原所有设置到默认值吗？\n注意：\n1. 所有设置将被立即还原并保存\n2. 使用前请先配置必要的API信息\n3. 请记得测试API配置是否正确')) {
                resetOptions();
            }
        });
    }
    
    // saveOnlyBtn
    const saveOnlyBtn = document.getElementById('saveOnlyBtn');
    if (saveOnlyBtn) {
        saveOnlyBtn.addEventListener('click', async () => {
            const maxTokensInput = document.getElementById('max_tokens_input');
            const temperatureInput = document.getElementById('temperature_input');

            if (validateNumberInput(maxTokensInput, 1024, 8192) &&
                validateNumberInput(temperatureInput, 0, 1, true)) {
                await saveSettings(false);
            }
        });
    }
    
    // saveAndTestBtn
    const saveAndTestBtn = document.getElementById('saveAndTestBtn');
    if (saveAndTestBtn) {
        saveAndTestBtn.addEventListener('click', async () => {
            const maxTokensInput = document.getElementById('max_tokens_input');
            const temperatureInput = document.getElementById('temperature_input');

            if (validateNumberInput(maxTokensInput, 1024, 8192) &&
                validateNumberInput(temperatureInput, 0, 1, true)) {
                await saveSettings(true);
            }
        });
    }
});