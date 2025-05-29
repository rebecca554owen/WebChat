// 在文件开头添加marked的初始化
let markedInstance;

// 初始化marked
async function initMarked() {
    try {
        // 等待marked加载完成
        await new Promise((resolve) => {
            if (typeof marked !== 'undefined') {
                resolve();
            } else {
                // 如果marked还没有加载，创建一个新的script标签
                const script = document.createElement('script');
                script.src = '../lib/marked.min.js';
                script.onload = resolve;
                document.head.appendChild(script);
            }
        });

        // 配置marked选项
        marked.setOptions({
            breaks: true,      // 将换行符转换为<br>
            gfm: true,         // 启用GitHub风格的Markdown
            headerIds: false,  // 禁用标题ID以避免潜在的冲突
            mangle: false      // 禁用标题ID转义
        });

        // 使用marked.parse而不是直接使用marked
        markedInstance = marked.parse;
        console.log('Marked初始化成功');
    } catch (error) {
        console.error('Marked初始化失败:', error);
        // 提供一个后备方案
        markedInstance = text => text;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // 在其他代码执行前先初始化marked
    await initMarked();

    // 初始化窗口设置
    await initializeWindowSettings();

    // 添加窗口大小调节功能
    setupWindowResize();

    const userInput = document.getElementById('userInput');
    const askButton = document.getElementById('askButton');
    const messagesContainer = document.getElementById('messages');
    let isGenerating = false;

    // 获取当前标签页ID
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab.id;

    // 初始化悬浮球开关状态
    const toggleBall = document.getElementById('toggleBall');
    const { showFloatingBall = true } = await chrome.storage.sync.get('showFloatingBall');
    toggleBall.checked = showFloatingBall;

    // 监听开关变化
    toggleBall.addEventListener('change', async () => {
        await chrome.storage.sync.set({ showFloatingBall: toggleBall.checked });
        // 向content script发送消息以更新悬浮球状态
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { action: 'toggleFloatingBall' });
        }
    });

    // 加载历史会话
    async function loadHistory() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getHistory',
                tabId: tabId
            });

            // 清空现有消息
            messagesContainer.innerHTML = '';

            if (!response || !response.history || response.history.length === 0) {
                // 没有历史记录时，显示欢迎消息
                const welcomeDiv = document.createElement('div');
                welcomeDiv.className = 'welcome-message';
                welcomeDiv.innerHTML = '<p>👋 你好！我是AI助手，可以帮你理解和分析当前网页的内容。</p>';
                messagesContainer.appendChild(welcomeDiv);
            } else {
                // 显示历史消息
                response.history.forEach(msg => {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = `message ${msg.isUser ? 'user-message' : 'assistant-message'}`;
                    if (msg.isUser) {
                        messageDiv.textContent = msg.content;
                    } else {
                        try {
                            messageDiv.innerHTML = markedInstance(msg.content);
                        } catch (error) {
                            console.error('Markdown渲染失败:', error);
                            messageDiv.textContent = msg.content;
                        }
                    }
                    messagesContainer.appendChild(messageDiv);
                });

                // 如果正在生成回答，添加加载指示器并连接到流
                if (response.isGenerating) {
                    isGenerating = true;
                    userInput.disabled = true;
                    askButton.disabled = true;

                    // 添加最后一个用户问题（如果不存在）
                    const lastMessage = response.history[response.history.length - 1];
                    if (!lastMessage || !lastMessage.isUser) {
                        const userQuestion = response.pendingQuestion;
                        if (userQuestion) {
                            const questionDiv = document.createElement('div');
                            questionDiv.className = 'message user-message';
                            questionDiv.textContent = userQuestion;
                            messagesContainer.appendChild(questionDiv);
                        }
                    }

                    // 添加空的回答消息和加载指示器
                    const messageDiv = addMessage('', false);
                    const typingIndicator = addTypingIndicator();

                    // 连接到流
                    const port = chrome.runtime.connect({ name: "answerStream" });
                    let answer = response.currentAnswer || ''; // 使用已生成的部分答案

                    // 如果有已生成的部分答案，立即显示
                    if (answer) {
                        try {
                            messageDiv.innerHTML = markedInstance(answer);
                        } catch (error) {
                            console.error('Markdown渲染失败:', error);
                            messageDiv.textContent = answer;
                        }
                    }

                    port.onMessage.addListener(async (msg) => {
                        if (msg.type === 'answer-chunk') {
                            answer += msg.content;
                            try {
                                messageDiv.innerHTML = markedInstance(answer);
                            } catch (error) {
                                console.error('Markdown渲染失败:', error);
                                messageDiv.textContent = answer;
                            }
                            messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        } else if (msg.type === 'answer-end') {
                            messageDiv.removeAttribute('data-pending');
                            isGenerating = false;
                            userInput.disabled = false;
                            askButton.disabled = false;
                            userInput.focus();
                            typingIndicator.remove();
                            port.disconnect();
                        } else if (msg.type === 'error') {
                            messageDiv.remove();
                            addMessage('发生错误：' + msg.error, false);
                            isGenerating = false;
                            userInput.disabled = false;
                            askButton.disabled = false;
                            userInput.focus();
                            typingIndicator.remove();
                            port.disconnect();
                        }
                    });

                    // 重新连接到现有的生成流
                    port.postMessage({
                        action: 'reconnectStream',
                        tabId: tabId
                    });
                }
            }
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } catch (error) {
            console.error('加载历史记录失败:', error);
            messagesContainer.innerHTML = `
                <div class="welcome-message">
                    <p>👋 你好！我是AI助手，可以帮你理解和分析当前网页的内容。</p>
                </div>
            `;
        }
    }

// ==================== 历史记录管理器 ====================
class HistoryManager {
    constructor(tabId, messagesContainer, messageManager) {
        this.tabId = tabId;
        this.messagesContainer = messagesContainer;
        this.messageManager = messageManager;
    }

    // 保存历史记录
    async saveHistory() {
        try {
            const messages = Array.from(this.messagesContainer.children)
                .filter(msg => !msg.classList.contains('typing-indicator') && !msg.hasAttribute('data-pending'))
                .map(msg => ({
                    content: msg.textContent || msg.innerText,
                    isUser: msg.classList.contains('user-message')
                }));

            await chrome.runtime.sendMessage({
                action: 'saveHistory',
                tabId: this.tabId,
                history: messages
            });
        } catch (error) {
            console.error('保存历史记录失败:', error);
        }
    }

    // 加载历史会话
    async loadHistory() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getHistory',
                tabId: this.tabId
            });

            if (response && response.history && response.history.length > 0) {
                // 清空现有消息
                this.messagesContainer.innerHTML = '';

                // 重新添加历史消息
                response.history.forEach(msg => {
                    this.messageManager.addMessage(msg.content, msg.isUser);
                });

                console.log('历史会话已加载:', response.history.length, '条消息');
            }
        } catch (error) {
            console.error('加载历史记录失败:', error);
        }
    }

    // 清空历史记录
    async clearHistory() {
        try {
            await chrome.runtime.sendMessage({
                action: 'clearHistory',
                tabId: this.tabId
            });
            this.messagesContainer.innerHTML = '';
            console.log('历史记录已清空');
        } catch (error) {
            console.error('清空历史记录失败:', error);
        }
    }
}

    // ==================== 工具类 ====================
    class PopupUtils {
        static async ensureContentScriptLoaded(tabId) {
            try {
                await chrome.tabs.sendMessage(tabId, { action: 'ping' });
                return true;
            } catch (error) {
                // 如果content script未加载，注入它
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: ['content.js']
                    });
                    // 等待content script初始化
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return true;
                } catch (error) {
                    console.error('Failed to inject content script:', error);
                    return false;
                }
            }
        }

        static async getPageContent(tab, maxRetries = 3) {
            for (let i = 0; i < maxRetries; i++) {
                try {
                    // 确保content script已加载
                    await PopupUtils.ensureContentScriptLoaded(tab.id);

                    // 尝试获取页面内容
                    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContent' });
                    return response.content;
                } catch (error) {
                    if (i === maxRetries - 1) {
                        throw new Error('无法获取页面内容，请刷新页面后重试');
                    }
                    // 等待一段时间后重试
                    await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
                }
            }
        }
    }

    // ==================== Markdown渲染器 ====================
    class MarkdownRenderer {
        constructor() {
            this.markedInstance = null;
        }

        init() {
            if (typeof marked !== 'undefined') {
                // 配置marked选项
                marked.setOptions({
                    breaks: true,
                    gfm: true,
                    sanitize: false,
                    smartLists: true,
                    smartypants: false
                });
                
                // 创建marked实例
                this.markedInstance = marked;
                console.log('Marked库已初始化');
            } else {
                console.error('Marked库未加载');
            }
        }

        render(content) {
            if (!this.markedInstance) {
                return content;
            }
            try {
                return this.markedInstance(content);
            } catch (error) {
                console.error('Markdown渲染失败:', error);
                return content;
            }
        }
    }

// ==================== 消息管理器 ====================
class MessageManager {
    constructor(messagesContainer, markdownRenderer, saveHistoryCallback) {
        this.messagesContainer = messagesContainer;
        this.markdownRenderer = markdownRenderer;
        this.saveHistoryCallback = saveHistoryCallback;
    }

    // 添加消息到聊天界面
    addMessage(content, isUser = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'assistant-message'}`;

        if (!isUser && content === '') {
            messageDiv.setAttribute('data-pending', 'true');
        } else {
            if (isUser) {
                messageDiv.textContent = content;
            } else {
                messageDiv.innerHTML = this.markdownRenderer.render(content);
            }
        }

        this.messagesContainer.appendChild(messageDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

        if (content !== '' || isUser) {
            this.saveHistoryCallback();
        }

        return messageDiv;
    }

    // 添加打字指示器
    addTypingIndicator() {
        const indicatorDiv = document.createElement('div');
        indicatorDiv.className = 'message assistant-message typing-indicator';
        indicatorDiv.innerHTML = '<span></span><span></span><span></span>';
        this.messagesContainer.appendChild(indicatorDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        return indicatorDiv;
    }

    // 流式输出文本
    async streamText(text, messageDiv) {
        const delay = 20; // 每个字符的延迟时间（毫秒）
        let currentText = '';

        for (let char of text) {
            currentText += char;
            messageDiv.innerHTML = this.markdownRenderer.render(currentText);
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        // 移除pending标记并保存完整的历史记录
        messageDiv.removeAttribute('data-pending');
        this.saveHistoryCallback();
    }

    // 更新消息内容（用于流式更新）
    updateMessage(messageDiv, content) {
        messageDiv.innerHTML = this.markdownRenderer.render(content);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    // 完成消息（移除pending状态）
    completeMessage(messageDiv) {
        messageDiv.removeAttribute('data-pending');
        this.saveHistoryCallback();
    }
}

// ==================== 用户输入处理器 ====================
class InputHandler {
    constructor(tab, tabId, userInput, askButton, messageManager) {
        this.tab = tab;
        this.tabId = tabId;
        this.userInput = userInput;
        this.askButton = askButton;
        this.messageManager = messageManager;
        this.isGenerating = false;
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        // 发送按钮点击事件
        this.askButton.addEventListener('click', () => this.handleUserInput());

        // 输入框回车事件（Shift+Enter换行）
        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleUserInput();
            }
        });

        // 自动调整输入框高度
        this.userInput.addEventListener('input', () => {
            this.userInput.style.height = 'auto';
            this.userInput.style.height = Math.min(this.userInput.scrollHeight, 100) + 'px';
        });
    }

    // 处理用户输入
    async handleUserInput() {
        if (this.isGenerating) return;

        const question = this.userInput.value.trim();
        if (!question) return;

        // 禁用输入和发送按钮
        this.isGenerating = true;
        this.userInput.disabled = true;
        this.askButton.disabled = true;
        this.userInput.value = '';

        try {
            // 从content script获取网页内容
            const pageContent = await PopupUtils.getPageContent(this.tab);

            // 先添加用户消息
            this.messageManager.addMessage(question, true);

            // 添加空的回答消息和打字指示器
            const messageDiv = this.messageManager.addMessage('', false);
            const typingIndicator = this.messageManager.addTypingIndicator();

            // 开始监听答案更新
            const port = chrome.runtime.connect({ name: "answerStream" });
            let answer = '';

            port.onMessage.addListener(async (msg) => {
                if (msg.type === 'answer-chunk') {
                    // 流式更新答案
                    answer += msg.content;
                    this.messageManager.updateMessage(messageDiv, answer);
                } else if (msg.type === 'answer-end') {
                    // 答案生成完成
                    this.messageManager.completeMessage(messageDiv);
                    this.resetInputState();
                    typingIndicator.remove();
                    port.disconnect();
                } else if (msg.type === 'error') {
                    messageDiv.remove(); // 移除空的消息div
                    this.messageManager.addMessage('发生错误：' + msg.error, false);
                    this.resetInputState();
                    typingIndicator.remove();
                    port.disconnect();
                }
            });

            // 发送生成请求到background
            port.postMessage({
                action: 'generateAnswer',
                tabId: this.tabId,
                pageContent: pageContent,
                question: question
            });

        } catch (error) {
            this.messageManager.addMessage('发生错误：' + error.message, false);
            this.resetInputState();
        }
    }

    // 重置输入状态
    resetInputState() {
        this.isGenerating = false;
        this.userInput.disabled = false;
        this.askButton.disabled = false;
        this.userInput.focus();
    }

    // 获取生成状态
    getGeneratingState() {
        return this.isGenerating;
    }
}

    // ==================== 主应用类 ====================
    class PopupApp {
        constructor() {
            this.tabId = null;
            this.tab = null;
            this.messagesContainer = null;
            this.userInput = null;
            this.askButton = null;
            
            this.markdownRenderer = new MarkdownRenderer();
            this.messageManager = null;
            this.historyManager = null;
            this.inputHandler = null;
        }

        async init() {
            // 初始化Markdown
            this.markdownRenderer.init();

            // 初始化窗口设置
            await initializeWindowSettings();
            
            // 添加窗口大小调节功能
            setupWindowResize();

            // 获取DOM元素
            this.messagesContainer = document.getElementById('messages');
            this.userInput = document.getElementById('userInput');
            this.askButton = document.getElementById('askButton');

            // 获取当前标签页
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                this.tab = tabs[0];
                this.tabId = this.tab.id;
                console.log('当前标签页ID:', this.tabId);
            } catch (error) {
                console.error('获取标签页失败:', error);
                return;
            }

            // 初始化管理器
            this.messageManager = new MessageManager(
                this.messagesContainer, 
                this.markdownRenderer, 
                () => this.historyManager.saveHistory()
            );
            
            this.historyManager = new HistoryManager(
                this.tabId, 
                this.messagesContainer, 
                this.messageManager
            );
            
            this.inputHandler = new InputHandler(
                this.tab, 
                this.tabId, 
                this.userInput, 
                this.askButton, 
                this.messageManager
            );

            // 初始化悬浮球开关状态
            await this.initializeBallToggle();

            // 检查是否有正在生成的回答需要重新连接
            await this.checkAndReconnectGenerating();

            // 初始化时加载历史会话
            await this.historyManager.loadHistory();
        }

        async initializeBallToggle() {
            try {
                const { ballEnabled } = await chrome.storage.sync.get('ballEnabled');
                const ballToggle = document.getElementById('ballToggle');
                if (ballToggle) {
                    ballToggle.checked = ballEnabled !== false; // 默认为true
                    
                    // 监听开关变化
                    ballToggle.addEventListener('change', async (e) => {
                        const enabled = e.target.checked;
                        await chrome.storage.sync.set({ ballEnabled: enabled });
                        
                        // 通知content script更新悬浮球状态
                        try {
                            await chrome.tabs.sendMessage(this.tabId, {
                                action: 'toggleBall',
                                enabled: enabled
                            });
                        } catch (error) {
                            console.log('Content script可能未加载，这是正常的');
                        }
                    });
                }
            } catch (error) {
                console.error('初始化悬浮球开关失败:', error);
            }
        }

        async checkAndReconnectGenerating() {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'checkGenerating',
                    tabId: this.tabId
                });
                
                if (response && response.isGenerating) {
                    console.log('检测到正在生成的回答，重新连接流...');
                    
                    // 添加空的回答消息和打字指示器
                    const messageDiv = this.messageManager.addMessage('', false);
                    const typingIndicator = this.messageManager.addTypingIndicator();
                    
                    // 重新连接到流
                    const port = chrome.runtime.connect({ name: "answerStream" });
                    let answer = '';
                    
                    port.onMessage.addListener(async (msg) => {
                        if (msg.type === 'answer-chunk') {
                            answer += msg.content;
                            this.messageManager.updateMessage(messageDiv, answer);
                        } else if (msg.type === 'answer-end') {
                            this.messageManager.completeMessage(messageDiv);
                            typingIndicator.remove();
                            port.disconnect();
                        } else if (msg.type === 'error') {
                            messageDiv.remove();
                            this.messageManager.addMessage('发生错误：' + msg.error, false);
                            typingIndicator.remove();
                            port.disconnect();
                        }
                    });
                    
                    // 请求继续生成
                    port.postMessage({
                        action: 'reconnectStream',
                        tabId: this.tabId
                    });
                }
            } catch (error) {
                console.error('检查生成状态失败:', error);
            }
        }
    }

// 初始化应用
const app = new PopupApp();
await app.init();
});

// ==================== 窗口管理功能 ====================

// 默认窗口配置
const DEFAULT_WINDOW_CONFIG = {
    width: 400,
    height: 500,
    position: 'bottom-right' // 默认位置：右下角
};

// 初始化窗口设置
async function initializeWindowSettings() {
    try {
        // 获取保存的窗口配置
        const { popupConfig } = await chrome.storage.sync.get('popupConfig');
        
        let config = popupConfig || DEFAULT_WINDOW_CONFIG;
        
        // 确保配置有效性
        config = validateWindowConfig(config);
        
        // 应用窗口大小
        applyWindowSize(config.width, config.height);
        
        // 应用窗口位置（仅在支持的环境中）
        if (config.position) {
            applyWindowPosition(config.position);
        }
        
        console.log('窗口设置已初始化:', config);
    } catch (error) {
        console.error('初始化窗口设置失败:', error);
        // 使用默认配置
        applyWindowSize(DEFAULT_WINDOW_CONFIG.width, DEFAULT_WINDOW_CONFIG.height);
    }
}

// 验证窗口配置
function validateWindowConfig(config) {
    const validated = { ...DEFAULT_WINDOW_CONFIG, ...config };
    
    // 验证宽度
    validated.width = Math.max(300, Math.min(800, validated.width || DEFAULT_WINDOW_CONFIG.width));
    
    // 验证高度
    validated.height = Math.max(400, Math.min(700, validated.height || DEFAULT_WINDOW_CONFIG.height));
    
    // 验证位置
    const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];
    if (!validPositions.includes(validated.position)) {
        validated.position = DEFAULT_WINDOW_CONFIG.position;
    }
    
    return validated;
}

// 应用窗口大小
function applyWindowSize(width, height) {
    document.body.style.width = `${width}px`;
    document.body.style.height = `${height}px`;
    
    // 设置最小尺寸
    document.body.style.minWidth = '300px';
    document.body.style.minHeight = '400px';
    
    // 设置最大尺寸
    document.body.style.maxWidth = '800px';
    document.body.style.maxHeight = '700px';
}

// 应用窗口位置（针对弹窗扩展的特殊处理）
function applyWindowPosition(position) {
    try {
        // 为popup添加位置相关的CSS类
        document.body.classList.remove('pos-top-left', 'pos-top-right', 'pos-bottom-left', 'pos-bottom-right', 'pos-center');
        document.body.classList.add(`pos-${position}`);
        
        // 如果是在扩展popup环境中，尝试设置窗口位置
        if (chrome.windows && chrome.windows.getCurrent) {
            chrome.windows.getCurrent((currentWindow) => {
                if (currentWindow && currentWindow.type === 'popup') {
                    const screenWidth = screen.availWidth;
                    const screenHeight = screen.availHeight;
                    const windowWidth = parseInt(document.body.style.width) || DEFAULT_WINDOW_CONFIG.width;
                    const windowHeight = parseInt(document.body.style.height) || DEFAULT_WINDOW_CONFIG.height;
                    
                    let left, top;
                    
                    switch (position) {
                        case 'top-left':
                            left = 50;
                            top = 50;
                            break;
                        case 'top-right':
                            left = screenWidth - windowWidth - 50;
                            top = 50;
                            break;
                        case 'bottom-left':
                            left = 50;
                            top = screenHeight - windowHeight - 100;
                            break;
                        case 'bottom-right':
                        default:
                            left = screenWidth - windowWidth - 50;
                            top = screenHeight - windowHeight - 100;
                            break;
                        case 'center':
                            left = (screenWidth - windowWidth) / 2;
                            top = (screenHeight - windowHeight) / 2;
                            break;
                    }
                    
                    // 更新窗口位置
                    chrome.windows.update(currentWindow.id, {
                        left: Math.max(0, Math.floor(left)),
                        top: Math.max(0, Math.floor(top))
                    });
                }
            });
        }
    } catch (error) {
        console.warn('设置窗口位置失败:', error);
    }
}

// 设置窗口大小调节功能
function setupWindowResize() {
    // 创建调整大小的控制柄
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.title = '拖拽调整窗口大小';
    document.body.appendChild(resizeHandle);
    
    // 创建位置选择器
    createPositionSelector();
    
    let isResizing = false;
    let startX, startY, startWidth, startHeight;
    
    // 鼠标按下开始调整
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = parseInt(document.body.style.width) || DEFAULT_WINDOW_CONFIG.width;
        startHeight = parseInt(document.body.style.height) || DEFAULT_WINDOW_CONFIG.height;
        
        e.preventDefault();
        e.stopPropagation();
        
        // 添加调整中的样式
        document.body.classList.add('resizing');
    });
    
    // 鼠标移动调整大小
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        const newWidth = Math.max(300, Math.min(800, startWidth + deltaX));
        const newHeight = Math.max(400, Math.min(700, startHeight + deltaY));
        
        applyWindowSize(newWidth, newHeight);
    });
    
    // 鼠标释放完成调整
    document.addEventListener('mouseup', async () => {
        if (isResizing) {
            isResizing = false;
            document.body.classList.remove('resizing');
            
            // 保存新的窗口配置
            await saveWindowConfig();
        }
    });
    
    // 防止拖拽时选中文本
    document.addEventListener('selectstart', (e) => {
        if (isResizing) {
            e.preventDefault();
        }
    });
}

// 创建位置选择器
function createPositionSelector() {
    const positionSelector = document.createElement('div');
    positionSelector.className = 'position-selector';
    positionSelector.innerHTML = `
        <select id="windowPosition" title="选择窗口位置">
            <option value="bottom-right">右下角</option>
            <option value="bottom-left">左下角</option>
            <option value="top-right">右上角</option>
            <option value="top-left">左上角</option>
            <option value="center">居中</option>
        </select>
    `;
    
    document.body.appendChild(positionSelector);
    
    const select = document.getElementById('windowPosition');
    
    // 加载当前位置设置
    chrome.storage.sync.get('popupConfig').then(({ popupConfig }) => {
        if (popupConfig && popupConfig.position) {
            select.value = popupConfig.position;
        }
    });
    
    // 监听位置变化
    select.addEventListener('change', async () => {
        const newPosition = select.value;
        applyWindowPosition(newPosition);
        await saveWindowConfig({ position: newPosition });
    });
}

// 保存窗口配置
async function saveWindowConfig(updates = {}) {
    try {
        const { popupConfig } = await chrome.storage.sync.get('popupConfig');
        
        const currentConfig = {
            width: parseInt(document.body.style.width) || DEFAULT_WINDOW_CONFIG.width,
            height: parseInt(document.body.style.height) || DEFAULT_WINDOW_CONFIG.height,
            position: document.getElementById('windowPosition')?.value || DEFAULT_WINDOW_CONFIG.position,
            ...popupConfig,
            ...updates
        };
        
        // 验证配置
        const validatedConfig = validateWindowConfig(currentConfig);
        
        // 保存到存储
        await chrome.storage.sync.set({ popupConfig: validatedConfig });
        
        console.log('窗口配置已保存:', validatedConfig);
    } catch (error) {
        console.error('保存窗口配置失败:', error);
    }
}

// 重置窗口到默认设置
async function resetWindowToDefault() {
    try {
        applyWindowSize(DEFAULT_WINDOW_CONFIG.width, DEFAULT_WINDOW_CONFIG.height);
        applyWindowPosition(DEFAULT_WINDOW_CONFIG.position);
        
        const select = document.getElementById('windowPosition');
        if (select) {
            select.value = DEFAULT_WINDOW_CONFIG.position;
        }
        
        await chrome.storage.sync.set({ popupConfig: DEFAULT_WINDOW_CONFIG });
        
        console.log('窗口已重置为默认设置');
    } catch (error) {
        console.error('重置窗口设置失败:', error);
    }
}

// 导出窗口管理函数（供其他脚本使用）
window.windowManager = {
    resetToDefault: resetWindowToDefault,
    saveConfig: saveWindowConfig,
    applyPosition: applyWindowPosition,
    applySize: applyWindowSize
};