// WebChat AI助手 - Background Service Worker
// 处理API调用、消息传递、历史记录管理等核心功能

// ==================== 配置常量 ====================

const DEFAULT_SETTINGS = {
    autoHideDialog: true,
    base_url: 'https://api.freewife.online',
    api_key: '',
    model: 'deepseek-v3',
    enableContext: true,
    stream: true,
    max_tokens: 2048,
    temperature: 0.6,
    system_prompt: '你是一个帮助理解网页内容的AI助手，请使用MD格式回复。'
};

// ==================== 全局变量 ====================

// 存储每个标签页的会话历史
const tabHistories = new Map();

// 存储当前生成状态
const generationStates = new Map();

// 存储活跃的端口连接
const activePorts = new Map();

// ==================== 工具函数 ====================

// 格式化API地址
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

// 解析网页内容
function parseWebContent(content) {
    if (!content) return '';
    
    return content
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim()
        .substring(0, 8000); // 限制长度
}

// 构建对话消息
function buildMessages(settings, pageContent, question, history = []) {
    const messages = [];
    
    // 添加系统提示
    if (settings.system_prompt) {
        messages.push({
            role: "system",
            content: settings.system_prompt
        });
    }
    
    // 添加网页内容上下文
    if (pageContent) {
        messages.push({
            role: "system",
            content: `当前网页内容：\n${pageContent}`
        });
    }
    
    // 添加历史对话（如果启用上下文）
    if (settings.enableContext && history.length > 0) {
        const maxRounds = 4;
        const recentHistory = history.slice(-maxRounds * 2); // 每轮包含用户和助手消息
        
        recentHistory.forEach(msg => {
            messages.push({
                role: msg.isUser ? "user" : "assistant",
                content: msg.content
            });
        });
    }
    
    // 添加当前问题
    messages.push({
        role: "user",
        content: question
    });
    
    return messages;
}

// ==================== API调用函数 ====================

// 调用AI API
async function callAI(settings, messages, onChunk, onComplete, onError) {
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (settings.api_key) {
            headers['Authorization'] = `Bearer ${settings.api_key}`;
        }
        
        const requestBody = {
            model: settings.model,
            messages: messages,
            max_tokens: settings.max_tokens,
            temperature: settings.temperature,
            stream: settings.stream !== false
        };
        
        const response = await fetch(formatBaseUrl(settings.base_url), {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error?.message || '请求失败';
            } catch (e) {
                errorMessage = `请求失败: ${errorText}`;
            }
            throw new Error(errorMessage);
        }
        
        if (requestBody.stream) {
            await handleStreamResponse(response, onChunk, onComplete, onError);
        } else {
            const data = await response.json();
            if (data.error || !data.choices?.[0]?.message) {
                throw new Error(data.error || '无效的API响应格式');
            }
            const content = data.choices[0].message.content;
            onChunk(content);
            onComplete(content);
        }
        
    } catch (error) {
        onError(error.message);
    }
}

// 处理流式响应
async function handleStreamResponse(response, onChunk, onComplete, onError) {
    try {
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
                    if (data === '[DONE]') {
                        onComplete(fullResponse);
                        return;
                    }
                    
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        if (content) {
                            fullResponse += content;
                            onChunk(content);
                        }
                    } catch (e) {
                        console.warn('解析流式响应失败:', e);
                    }
                }
            }
        }
        
        onComplete(fullResponse);
    } catch (error) {
        onError(error.message);
    }
}

// ==================== 历史记录管理 ====================

// 获取标签页历史记录
function getTabHistory(tabId) {
    return tabHistories.get(tabId) || [];
}

// 保存标签页历史记录
function saveTabHistory(tabId, history) {
    tabHistories.set(tabId, history);
}

// 添加消息到历史记录
function addToHistory(tabId, content, isUser, markdownContent = null) {
    const history = getTabHistory(tabId);
    history.push({
        content,
        isUser,
        markdownContent: markdownContent || content,
        timestamp: Date.now()
    });
    saveTabHistory(tabId, history);
}

// 清空历史记录
function clearTabHistory(tabId) {
    tabHistories.delete(tabId);
    generationStates.delete(tabId);
}

// ==================== 消息处理 ====================

// 处理来自content script和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
        switch (request.action) {
            case 'getCurrentTab':
                handleGetCurrentTab(sendResponse);
                break;
                
            case 'getHistory':
                handleGetHistory(request, sendResponse);
                break;
                
            case 'saveHistory':
                handleSaveHistory(request, sendResponse);
                break;
                
            case 'clearHistory':
                handleClearHistory(request, sendResponse);
                break;
                
            case 'openOptions':
                handleOpenOptions(sendResponse);
                break;
                
            default:
                sendResponse({ error: '未知的操作类型' });
        }
    } catch (error) {
        console.error('处理消息时出错:', error);
        sendResponse({ error: error.message });
    }
    
    return true; // 保持消息通道开放
});

// 处理获取当前标签页
async function handleGetCurrentTab(sendResponse) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        sendResponse({ tabId: tab?.id });
    } catch (error) {
        sendResponse({ error: '无法获取当前标签页' });
    }
}

// 处理获取历史记录
function handleGetHistory(request, sendResponse) {
    const { tabId } = request;
    const history = getTabHistory(tabId);
    const generationState = generationStates.get(tabId);
    
    sendResponse({
        history,
        isGenerating: generationState?.isGenerating || false,
        currentAnswer: generationState?.currentAnswer || '',
        pendingQuestion: generationState?.pendingQuestion || ''
    });
}

// 处理保存历史记录
function handleSaveHistory(request, sendResponse) {
    const { tabId, history } = request;
    saveTabHistory(tabId, history);
    sendResponse({ success: true });
}

// 处理清空历史记录
function handleClearHistory(request, sendResponse) {
    const { tabId } = request;
    clearTabHistory(tabId);
    sendResponse({ success: true });
}

// 处理打开选项页面
function handleOpenOptions(sendResponse) {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
}

// ==================== 端口连接处理 ====================

// 处理长连接
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "answerStream") {
        handleAnswerStream(port);
    }
});

// 处理答案流
function handleAnswerStream(port) {
    port.onMessage.addListener(async (msg) => {
        try {
            switch (msg.action) {
                case 'generateAnswer':
                    await handleGenerateAnswer(msg, port);
                    break;
                    
                case 'reconnectStream':
                    handleReconnectStream(msg, port);
                    break;
                    
                case 'stopGeneration':
                    handleStopGeneration(msg, port);
                    break;
            }
        } catch (error) {
            console.error('处理端口消息时出错:', error);
            port.postMessage({
                type: 'error',
                error: error.message
            });
        }
    });
    
    port.onDisconnect.addListener(() => {
        // 清理端口连接
        for (const [tabId, portInfo] of activePorts.entries()) {
            if (portInfo.port === port) {
                activePorts.delete(tabId);
                break;
            }
        }
    });
}

// 处理生成答案
async function handleGenerateAnswer(msg, port) {
    const { tabId, pageContent, question } = msg;
    
    try {
        // 获取设置
        const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
        
        // 验证设置
        if (!settings.base_url?.trim()) {
            throw new Error('请先在设置中配置API地址');
        }
        if (!settings.model?.trim()) {
            throw new Error('请先在设置中配置AI模型');
        }
        
        const isDefaultSettings = 
            settings.base_url === DEFAULT_SETTINGS.base_url &&
            settings.model === DEFAULT_SETTINGS.model;
            
        if (!settings.api_key?.trim() && !isDefaultSettings) {
            throw new Error('请先在设置中配置API密钥');
        }
        
        // 设置生成状态
        generationStates.set(tabId, {
            isGenerating: true,
            currentAnswer: '',
            pendingQuestion: question
        });
        
        // 保存端口连接
        activePorts.set(tabId, { port, tabId });
        
        // 添加用户问题到历史记录
        addToHistory(tabId, question, true);
        
        // 获取历史记录
        const history = getTabHistory(tabId);
        
        // 构建消息
        const messages = buildMessages(settings, parseWebContent(pageContent), question, history.slice(0, -1));
        
        let fullAnswer = '';
        
        // 调用AI API
        await callAI(
            settings,
            messages,
            // onChunk
            (chunk) => {
                fullAnswer += chunk;
                const state = generationStates.get(tabId);
                if (state) {
                    state.currentAnswer = fullAnswer;
                }
                
                port.postMessage({
                    type: 'answer-chunk',
                    content: chunk
                });
            },
            // onComplete
            (finalAnswer) => {
                // 添加完整答案到历史记录
                addToHistory(tabId, finalAnswer, false, finalAnswer);
                
                // 清理生成状态
                generationStates.delete(tabId);
                activePorts.delete(tabId);
                
                port.postMessage({
                    type: 'answer-end',
                    content: finalAnswer
                });
            },
            // onError
            (error) => {
                // 清理生成状态
                generationStates.delete(tabId);
                activePorts.delete(tabId);
                
                port.postMessage({
                    type: 'error',
                    error: error
                });
            }
        );
        
    } catch (error) {
        // 清理生成状态
        generationStates.delete(tabId);
        activePorts.delete(tabId);
        
        port.postMessage({
            type: 'error',
            error: error.message
        });
    }
}

// 处理重连流
function handleReconnectStream(msg, port) {
    const { tabId } = msg;
    const state = generationStates.get(tabId);
    
    if (state && state.isGenerating) {
        // 更新端口连接
        activePorts.set(tabId, { port, tabId });
        
        // 发送当前已生成的内容
        if (state.currentAnswer) {
            port.postMessage({
                type: 'answer-chunk',
                content: state.currentAnswer
            });
        }
    } else {
        port.postMessage({
            type: 'error',
            error: '没有正在进行的生成任务'
        });
    }
}

// 处理停止生成
function handleStopGeneration(msg, port) {
    const { tabId } = msg;
    
    // 清理生成状态
    generationStates.delete(tabId);
    activePorts.delete(tabId);
    
    port.postMessage({
        type: 'answer-end',
        content: '生成已停止'
    });
}

// ==================== 扩展生命周期 ====================

// 扩展安装时的初始化
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // 首次安装时设置默认配置
        chrome.storage.sync.set(DEFAULT_SETTINGS);
        console.log('WebChat AI助手已安装');
    } else if (details.reason === 'update') {
        console.log('WebChat AI助手已更新');
    }
});

// 标签页关闭时清理数据
chrome.tabs.onRemoved.addListener((tabId) => {
    clearTabHistory(tabId);
});

// 标签页更新时清理生成状态（但保留历史记录）
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        const state = generationStates.get(tabId);
        if (state && state.isGenerating) {
            generationStates.delete(tabId);
            activePorts.delete(tabId);
        }
    }
});

// ==================== 错误处理 ====================

// 全局错误处理
self.addEventListener('error', (event) => {
    console.error('Background script error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

console.log('WebChat AI助手 Background Service Worker 已启动');