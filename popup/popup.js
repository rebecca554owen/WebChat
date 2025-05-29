// Markdown渲染器
class MarkdownRenderer {
    constructor() {
        this.marked = null;
        this.init();
    }

    init() {
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                breaks: true,
                gfm: true,
                headerIds: false,
                mangle: false
            });
            this.marked = marked.parse;
        } else {
            this.marked = text => text;
        }
    }

    render(content) {
        try {
            return this.marked(content);
        } catch (error) {
            console.error('Markdown渲染失败:', error);
            return content;
        }
    }
}

// 工具类
class PopupUtils {
    static async ensureContentScriptLoaded(tabId) {
        try {
            await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            return true;
        } catch (error) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js']
                });
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
                await PopupUtils.ensureContentScriptLoaded(tab.id);
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContent' });
                return response.content;
            } catch (error) {
                if (i === maxRetries - 1) {
                    throw new Error('无法获取页面内容，请刷新页面后重试');
                }
                await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
            }
        }
    }
}

// 历史记录管理器
class HistoryManager {
    constructor(tabId, messagesContainer, messageManager) {
        this.tabId = tabId;
        this.messagesContainer = messagesContainer;
        this.messageManager = messageManager;
    }

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

    async loadHistory() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getHistory',
                tabId: this.tabId
            });

            if (response?.history?.length > 0) {
                this.messagesContainer.innerHTML = '';
                response.history.forEach(msg => {
                    this.messageManager.addMessage(msg.content, msg.isUser);
                });
            } else {
                this.showWelcomeMessage();
            }
        } catch (error) {
            console.error('加载历史记录失败:', error);
            this.showWelcomeMessage();
        }
    }

    showWelcomeMessage() {
        this.messagesContainer.innerHTML = `
            <div class="welcome-message">
                <p>👋 你好！我是AI助手，可以帮你理解和分析当前网页的内容。</p>
            </div>
        `;
    }
}

// 消息管理器
class MessageManager {
    constructor(messagesContainer, markdownRenderer, saveHistoryCallback) {
        this.messagesContainer = messagesContainer;
        this.markdownRenderer = markdownRenderer;
        this.saveHistoryCallback = saveHistoryCallback;
    }

    addMessage(content, isUser = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'assistant-message'}`;

        if (!isUser && content === '') {
            messageDiv.setAttribute('data-pending', 'true');
        } else {
            messageDiv[isUser ? 'textContent' : 'innerHTML'] = isUser ? content : this.markdownRenderer.render(content);
        }

        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();

        if (content !== '' || isUser) {
            this.saveHistoryCallback();
        }

        return messageDiv;
    }

    addTypingIndicator() {
        const indicatorDiv = document.createElement('div');
        indicatorDiv.className = 'message assistant-message typing-indicator';
        indicatorDiv.innerHTML = '<span></span><span></span><span></span>';
        this.messagesContainer.appendChild(indicatorDiv);
        this.scrollToBottom();
        return indicatorDiv;
    }

    updateMessage(messageDiv, content) {
        messageDiv.innerHTML = this.markdownRenderer.render(content);
        this.scrollToBottom();
    }

    completeMessage(messageDiv) {
        messageDiv.removeAttribute('data-pending');
        this.saveHistoryCallback();
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
}

// 用户输入处理器
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
        this.askButton.addEventListener('click', () => this.handleUserInput());
        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleUserInput();
            }
        });
        this.userInput.addEventListener('input', () => {
            this.userInput.style.height = 'auto';
            this.userInput.style.height = Math.min(this.userInput.scrollHeight, 100) + 'px';
        });
    }

    async handleUserInput() {
        if (this.isGenerating) return;

        const question = this.userInput.value.trim();
        if (!question) return;

        this.setGeneratingState(true);
        this.userInput.value = '';

        try {
            const pageContent = await PopupUtils.getPageContent(this.tab);
            this.messageManager.addMessage(question, true);

            const messageDiv = this.messageManager.addMessage('', false);
            const typingIndicator = this.messageManager.addTypingIndicator();

            this.setupAnswerStream(messageDiv, typingIndicator, pageContent, question);
        } catch (error) {
            this.messageManager.addMessage('发生错误：' + error.message, false);
            this.setGeneratingState(false);
        }
    }

    setupAnswerStream(messageDiv, typingIndicator, pageContent, question) {
        const port = chrome.runtime.connect({ name: "answerStream" });
        let answer = '';

        port.onMessage.addListener((msg) => {
            if (msg.type === 'answer-chunk') {
                answer += msg.content;
                this.messageManager.updateMessage(messageDiv, answer);
            } else if (msg.type === 'answer-end') {
                this.messageManager.completeMessage(messageDiv);
                this.cleanup(typingIndicator, port);
            } else if (msg.type === 'error') {
                messageDiv.remove();
                this.messageManager.addMessage('发生错误：' + msg.error, false);
                this.cleanup(typingIndicator, port);
            }
        });

        port.postMessage({
            action: 'generateAnswer',
            tabId: this.tabId,
            pageContent: pageContent,
            question: question
        });
    }

    cleanup(typingIndicator, port) {
        this.setGeneratingState(false);
        typingIndicator.remove();
        port.disconnect();
    }

    setGeneratingState(generating) {
        this.isGenerating = generating;
        this.userInput.disabled = generating;
        this.askButton.disabled = generating;
        if (!generating) this.userInput.focus();
    }
}

// 主应用类
class PopupApp {
    constructor() {
        this.markdownRenderer = new MarkdownRenderer();
    }

    async init() {
        // 获取DOM元素和标签页信息
        const messagesContainer = document.getElementById('messages');
        const userInput = document.getElementById('userInput');
        const askButton = document.getElementById('askButton');
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tab.id;

        // 初始化管理器
        const historyManager = new HistoryManager(tabId, messagesContainer, null);
        const messageManager = new MessageManager(
            messagesContainer, 
            this.markdownRenderer, 
            () => historyManager.saveHistory()
        );
        historyManager.messageManager = messageManager;
        
        const inputHandler = new InputHandler(tab, tabId, userInput, askButton, messageManager);

        // 初始化悬浮球开关
        await this.initializeBallToggle(tabId);

        // 加载历史会话
        await historyManager.loadHistory();
    }

    async initializeBallToggle(tabId) {
        const { ballEnabled = true } = await chrome.storage.sync.get('ballEnabled');
        const ballToggle = document.getElementById('ballToggle');
        
        if (ballToggle) {
            ballToggle.checked = ballEnabled;
            ballToggle.addEventListener('change', async (e) => {
                const enabled = e.target.checked;
                await chrome.storage.sync.set({ ballEnabled: enabled });
                
                try {
                    await chrome.tabs.sendMessage(tabId, {
                        action: 'toggleBall',
                        enabled: enabled
                    });
                } catch (error) {
                    // Content script可能未加载，忽略错误
                }
            });
        }
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', async () => {
    const app = new PopupApp();
    await app.init();
});