// 存储会话历史的对象，键是标签ID
let sessionHistories = {};
// 存储生成状态的对象，键是标签ID
let generatingStates = {};
// 用于跟踪当前正在生成的答案
let currentAnswers = {};
// 存储活动端口的对象，键是标签ID
let activePorts = {};
// 存储已完成的答案，键是标签ID
let completedAnswers = {};

// 监听扩展安装事件
chrome.runtime.onInstalled.addListener(() => {
    console.log('扩展已安装');
});

// 处理来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'saveHistory') {
        // 保存会话历史
        sessionHistories[request.tabId] = request.history;
        sendResponse({ status: 'ok' });
    } else if (request.action === 'getHistory') {
        const history = sessionHistories[request.tabId] || [];
        const state = generatingStates[request.tabId] || { isGenerating: false };

        // 如果正在生成答案，确保返回的历史记录中包含用户问题
        if (state.isGenerating && state.pendingQuestion) {
            const lastMessage = history[history.length - 1];
            if (!lastMessage || !lastMessage.isUser || lastMessage.content !== state.pendingQuestion) {
                // 创建一个新的历史记录数组，包含用户问题
                const updatedHistory = [...history, { content: state.pendingQuestion, isUser: true }];
                sendResponse({
                    history: updatedHistory,
                    isGenerating: state.isGenerating,
                    pendingQuestion: state.pendingQuestion,
                    currentAnswer: currentAnswers[request.tabId] || ''
                });
                return true;
            }
        }

        sendResponse({
            history: history,
            isGenerating: state.isGenerating,
            pendingQuestion: state.pendingQuestion,
            currentAnswer: currentAnswers[request.tabId] || ''
        });
    } else if (request.action === 'clearHistory') {
        // 清除会话历史
        delete sessionHistories[request.tabId];
        delete generatingStates[request.tabId];
        delete currentAnswers[request.tabId];
        sendResponse({ status: 'ok' });
    } else if (request.action === 'generateAnswer') {
        // 开始生成答案
        const state = generatingStates[request.tabId] || {};
        if (!state.isGenerating) {
            // 只有在没有生成进行中时才添加新的问题
            handleAnswerGeneration(request.tabId, request.pageContent, request.question);
            generatingStates[request.tabId] = {
                isGenerating: true,
                pendingQuestion: request.question
            };
        }
        sendResponse({ status: 'started' });
    } else if (request.action === 'getGeneratingState') {
        // 获取生成状态
        sendResponse(generatingStates[request.tabId] || { isGenerating: false });
    } else if (request.action === 'openPopup') {
        // 打开扩展的popup
        chrome.action.openPopup();
        sendResponse({ status: 'ok' });
    } else if (request.action === 'getCurrentTab') {
        // 返回发送消息的标签页ID
        sendResponse({ tabId: sender.tab.id });
    } else if (request.action === 'openOptions') {
        // 打开选项页面
        chrome.runtime.openOptionsPage();
        sendResponse({ status: 'ok' });
    }
    return true;
});

// 修改background.js中的消息处理
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "answerStream") {
        // 存储端口连接
        port.onMessage.addListener(async (request) => {
            const tabId = request.tabId;

            if (request.action === 'generateAnswer') {
                activePorts[tabId] = port;
                try {
                    await handleAnswerGeneration(port, tabId, request.pageContent, request.question);
                } catch (error) {
                    if (port === activePorts[tabId]) {
                        port.postMessage({ type: 'error', error: error.message });
                    }
                }
            } else if (request.action === 'reconnectStream') {
                // 如果有已完成的答案，直接发送完成信号
                if (completedAnswers[tabId]) {
                    port.postMessage({
                        type: 'answer-chunk',
                        content: completedAnswers[tabId]
                    });
                    port.postMessage({ type: 'answer-end' });
                    // 清理完成的答案
                    delete completedAnswers[tabId];
                } else if (currentAnswers[tabId]) {
                    // 如果有正在生成的答案，发送当前进度并继续监听
                    port.postMessage({
                        type: 'answer-chunk',
                        content: currentAnswers[tabId]
                    });
                    // 记录新的端口连接
                    activePorts[tabId] = port;
                } else if (generatingStates[tabId]?.isGenerating) {
                    // 如果正在生成但还没有内容，只更新端口连接
                    activePorts[tabId] = port;
                } else {
                    // 如果没有生成状态，发送完成信号
                    port.postMessage({ type: 'answer-end' });
                }
            }
        });

        // 监听端口断开
        port.onDisconnect.addListener(() => {
            // 找到并移除断开的端口
            for (const tabId in activePorts) {
                if (activePorts[tabId] === port) {
                    delete activePorts[tabId];
                    break;
                }
            }
        });
    }
});

// 修改handleAnswerGeneration函数
async function handleAnswerGeneration(port, tabId, pageContent, question) {
    try {
        // 在开始生成之前，先保存用户问题到历史记录
        let chatHistory = sessionHistories[tabId] || [];
        const lastMessage = chatHistory[chatHistory.length - 1];

        // 只有当最后一条不是相同的用户消息时才添加
        if (!lastMessage || !lastMessage.isUser || lastMessage.content !== question) {
            chatHistory.push({ content: question, isUser: true });
            sessionHistories[tabId] = chatHistory;
        }

        // 初始化当前答案
        currentAnswers[tabId] = '';
        completedAnswers[tabId] = null; // 重置已完成的答案

        // 设置生成状态
        generatingStates[tabId] = {
            isGenerating: true,
            pendingQuestion: question
        };

        // 获取设置
        const settings = await chrome.storage.sync.get({
            apiType: 'custom',
            maxTokens: 2048,
            temperature: 0.7,
            custom_apiKey: '',
            custom_apiBase: 'https://api.openai.com/v1/chat/completions',
            custom_model: 'gpt-3.5-turbo',
            ollama_apiKey: 'ollama',
            ollama_apiBase: 'http://127.0.0.1:11434/api/chat',
            ollama_model: 'qwen2.5'
        });

        // 获取当前API类型的配置
        const apiKey = settings[`${settings.apiType}_apiKey`];
        const apiBase = settings[`${settings.apiType}_apiBase`];
        const model = settings[`${settings.apiType}_model`];

        // 构建请求
        const headers = {
            'Content-Type': 'application/json'
        };

        if (settings.apiType === 'custom') {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        let requestBody;
        if (settings.apiType === 'ollama') {
            requestBody = {
                model: model,
                messages: [
                    {
                        role: "system",
                        content: "你是一个帮助理解网页内容的AI助手。请使用Markdown格式回复。"
                    },
                    {
                        role: "user",
                        content: `基于以下网页内容回答问题：\n\n${pageContent}\n\n问题：${question}`
                    }
                ],
                stream: true,
                options: {
                    temperature: settings.temperature,
                    num_predict: settings.maxTokens
                }
            };
        } else {
            requestBody = {
                model: model,
                messages: [
                    {
                        role: "system",
                        content: "你是一个帮助理解网页内容的AI助手。请使用Markdown格式回复。"
                    },
                    {
                        role: "user",
                        content: `基于以下网页内容回答问题：\n\n${pageContent}\n\n问题：${question}`
                    }
                ],
                max_tokens: settings.maxTokens,
                temperature: settings.temperature,
                stream: true // 启用流式输出
            };
        }

        let fullAnswer = ''; // 用于累积完整的答案

        const response = await fetch(apiBase, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error('API请求失败');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedResponse = '';

        while (true) {
            try {
                const { done, value } = await reader.read();

                // 检查端口是否已断开
                if (!port) {
                    console.log('Port disconnected, stopping generation');
                    await reader.cancel();
                    return;
                }

                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;

                    if (line.startsWith('data: ')) {
                        const data = line.slice(5).trim();

                        if (data === '[DONE]') {
                            continue;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            let content = '';

                            if (settings.apiType === 'ollama') {
                                content = parsed.message?.content || '';
                            } else {
                                content = parsed.choices?.[0]?.delta?.content || '';
                            }

                            if (content && port) { // 检查端口是否存在
                                accumulatedResponse += content;
                                try {
                                    port.postMessage({
                                        type: 'answer-chunk',
                                        content: content,
                                        markdownContent: accumulatedResponse
                                    });
                                } catch (portError) {
                                    console.log('Port disconnected during message sending');
                                    await reader.cancel();
                                    return;
                                }
                            }
                        } catch (parseError) {
                            console.warn('解析响应块时出错:', parseError, 'data:', data);
                            continue;
                        }
                    }
                }
            } catch (streamError) {
                console.error('Stream reading error:', streamError);
                if (port) {
                    try {
                        port.postMessage({
                            type: 'error',
                            error: '读取响应流时出错'
                        });
                    } catch (portError) {
                        console.log('Port disconnected during error sending');
                    }
                }
                return;
            }
        }

        // 发送完成消息
        if (port) {
            try {
                port.postMessage({
                    type: 'answer-end',
                    markdownContent: accumulatedResponse
                });

                // 保存对话历史
                const history = sessionHistories[tabId] || [];
                history.push(
                    { isUser: true, content: question, markdownContent: question },
                    { isUser: false, content: accumulatedResponse, markdownContent: accumulatedResponse }
                );
                sessionHistories[tabId] = history;
            } catch (portError) {
                console.log('Port disconnected during final message sending');
            }
        }

    } catch (error) {
        console.error('生成回答时出错:', error);
        if (port) {
            try {
                port.postMessage({
                    type: 'error',
                    error: error.message
                });
            } catch (portError) {
                console.log('Port disconnected during error sending');
            }
        }
    }
}

// 监听标签页更新事件，清理相关的会话历史
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        delete sessionHistories[tabId];
        delete generatingStates[tabId];
        delete currentAnswers[tabId];
        delete activePorts[tabId];
        delete completedAnswers[tabId];
    }
});

// 监听标签页关闭事件，清理相关的会话历史
chrome.tabs.onRemoved.addListener((tabId) => {
    delete sessionHistories[tabId];
    delete generatingStates[tabId];
    delete currentAnswers[tabId];
    delete activePorts[tabId];
    delete completedAnswers[tabId];
}); 