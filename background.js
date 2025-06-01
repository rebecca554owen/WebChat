// WebChat AI助手 - Background Service Worker
// 处理API调用、消息传递、历史记录管理等核心功能

// ==================== 配置常量 ====================

const DEFAULT_SETTINGS = {
    dialogPinned: false,
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

// 存储每个标签页的网页内容缓存
const pageContentCache = new Map();

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
        .substring(0, 8192); // 限制长度
}

// 优化网页内容，减少token消耗
function optimizePageContent(content) {
    if (!content) return '';
    
    // 移除重复的空白字符和换行
    let optimized = content
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
    
    // 如果内容过长，进行智能截取
    if (optimized.length > 16000) {
        // 保留开头和结尾的重要内容
        const start = optimized.substring(0, 8192);
        const end = optimized.substring(optimized.length - 4096);
        optimized = start + '\n\n[... 中间内容已省略 ...]\n\n' + end;
    }
    
    return optimized;
}

// 判断是否需要包含网页内容
function shouldIncludePageContent(tabId, pageContent, question, history) {
    if (!tabId || !pageContent) return false;
    
    // 检查缓存
    const cached = pageContentCache.get(tabId);
    const currentHash = generateContentHash(pageContent);
    
    // 如果是第一次对话或网页内容发生变化，需要发送
    if (!cached || cached.hash !== currentHash || history.length === 0) {
        return true;
    }
    
    // 检查问题是否与网页内容相关
    const contentRelatedKeywords = [
        // 页面相关
        '页面', '网页', '内容', '文章',
        // 指示词
        '这里', '这个', '上面', '下面',
        // 动作词
        '显示', '总结', '介绍', '根据'
    ];
    const isContentRelated = contentRelatedKeywords.some(keyword => 
        question.toLowerCase().includes(keyword)
    );
    
    // 如果最近5轮对话都没有涉及网页内容，且当前问题也不相关，则不发送
    const recentHistory = history.slice(-10); // 最近5轮对话
    const hasRecentContentReference = recentHistory.some(msg => 
        contentRelatedKeywords.some(keyword => 
            msg.content.toLowerCase().includes(keyword)
        )
    );
    
    return isContentRelated || hasRecentContentReference;
}

// 生成内容哈希值
function generateContentHash(content) {
    if (!content) return '';
    
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 转换为32位整数
    }
    return hash.toString();
}

// 构建对话消息
function buildMessages(settings, pageContent, question, history = [], tabId = null, needsPageContext = true) {
    const messages = [];
    
    // 添加系统提示
    if (settings.system_prompt) {
        messages.push({
            role: "system",
            content: settings.system_prompt
        });
    }
    
    // 添加系统时间上下文
    const currentTime = new Date();
    const timeString = currentTime.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'long',
        timeZone: 'Asia/Shanghai'
    });
    
    messages.push({
        role: "system",
        content: `当前时间：(UTC+8) ${timeString} , 注意时区问题`
    });
    
    // 智能添加网页内容上下文
    if (pageContent && needsPageContext) {
        // 检查是否需要发送网页内容
        const shouldSendPageContent = shouldIncludePageContent(tabId, pageContent, question, history);
        
        if (shouldSendPageContent) {
            const processedContent = optimizePageContent(pageContent);
            messages.push({
                role: "system",
                content: `当前网页内容：\n${processedContent}`
            });
            
            // 更新缓存
            if (tabId) {
                pageContentCache.set(tabId, {
                    content: pageContent,
                    hash: generateContentHash(pageContent),
                    lastUsed: Date.now()
                });
            }
        }
    }
    
    // 开启对话历史记录功能
    if (settings.enableContext && history.length > 0) {
        const maxRounds = 4;
        let historyToUse = history;
        
        // 检查历史记录的最后一条是否是当前用户问题，如果是则排除避免重复
        if (history.length > 0 && 
            history[history.length - 1].isUser && 
            history[history.length - 1].content === question) {
            historyToUse = history.slice(0, -1);
        }
        
        const recentHistory = historyToUse.slice(-maxRounds * 2); // 每轮包含用户和助手消息
        
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
    pageContentCache.delete(tabId);
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
                
            case 'clearCurrentTabHistory':
                handleClearCurrentTabHistory(request, sender, sendResponse);
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

// 处理清空当前标签页历史记录
function handleClearCurrentTabHistory(request, sender, sendResponse) {
    const tabId = sender.tab?.id;
    if (tabId) {
        clearTabHistory(tabId);
        sendResponse({ success: true });
    } else {
        sendResponse({ error: '无法获取标签页ID' });
    }
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

// 安全发送端口消息
function safePostMessage(port, message) {
    try {
        if (port && !port.disconnected) {
            port.postMessage(message);
            return true;
        }
    } catch (error) {
        console.warn('端口已断开连接，无法发送消息:', error);
    }
    return false;
}

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
            safePostMessage(port, {
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
                // 清理对应的生成状态
                generationStates.delete(tabId);
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
        const messages = buildMessages(settings, parseWebContent(pageContent), question, history, tabId, true);
        
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
                
                safePostMessage(port, {
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
                
                safePostMessage(port, {
                    type: 'answer-end',
                    content: finalAnswer
                });
            },
            // onError
            (error) => {
                // 清理生成状态
                generationStates.delete(tabId);
                activePorts.delete(tabId);
                
                safePostMessage(port, {
                    type: 'error',
                    error: error
                });
            }
        );
        
    } catch (error) {
        // 清理生成状态
        generationStates.delete(tabId);
        activePorts.delete(tabId);
        
        safePostMessage(port, {
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
            safePostMessage(port, {
                type: 'answer-chunk',
                content: state.currentAnswer
            });
        }
    } else {
        safePostMessage(port, {
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
    
    safePostMessage(port, {
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

// 定期清理过期的页面内容缓存
setInterval(() => {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30分钟
    
    for (const [tabId, cache] of pageContentCache.entries()) {
        if (now - cache.lastUsed > maxAge) {
            pageContentCache.delete(tabId);
        }
    }
}, 10 * 60 * 1000); // 每10分钟清理一次

// 标签页更新时的处理
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // URL变化时清空历史记录和页面缓存，确保不同网页初始状态一致
    if (changeInfo.url) {
        clearTabHistory(tabId);
    }
    
    // 页面加载时清理生成状态
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