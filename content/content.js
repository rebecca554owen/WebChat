/**
 * 解析网页内容，提取符合人类阅读习惯的结构化文本内容用于AI分析
 * 移除脚本、样式、导航、页脚等非内容元素，保留文档结构
 * @returns {string} 清理后的结构化网页文本内容
 */
function parseWebContent() {
    const docClone = document.cloneNode(true);
    
    // 移除不需要的元素
    const unwantedElements = docClone.querySelectorAll(
        'script, style, link[rel="stylesheet"], header, nav, footer, aside, ' +
        '.advertisement, .ads, .sidebar, .menu, .navigation, ' +
        '#ai-assistant-dialog, [class*="cookie"], [class*="popup"], ' +
        '.social-share, .related-posts, .comments'
    );
    
    unwantedElements.forEach(element => {
        if (element.parentNode) {
            element.parentNode.removeChild(element);
        }
    });
    
    // 智能选择主要内容区域
    const contentSelectors = [
        'main', 'article', '.content', '.main-content', '.post-content',
        '.entry-content', '[role="main"]', '.article-body', '.page-content'
    ];
    
    let mainContent = null;
    for (const selector of contentSelectors) {
        const candidate = docClone.querySelector(selector);
        if (candidate && candidate.textContent.trim().length > 100) {
            mainContent = candidate;
            break;
        }
    }
    
    if (!mainContent) {
        mainContent = docClone.querySelector('body');
    }
    
    // 提取结构化文本
    let structuredText = extractStructuredText(mainContent);
    
    // 过滤无关内容
    structuredText = filterRelevantContent(structuredText);
    
    // 最终清理
    return structuredText
        .replace(/\n{3,}/g, '\n\n') // 限制连续换行
        .replace(/[ \t]{2,}/g, ' ') // 合并多余空格
        .trim();
}

/**
 * 提取结构化文本，保留文档层次结构
 * @param {Element} element 要处理的DOM元素
 * @returns {string} 结构化文本
 */
function extractStructuredText(element) {
    if (!element) return '';
    
    let result = '';
    
    function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text) {
                result += text + ' ';
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            
            // 跳过隐藏元素
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') {
                return;
            }
            
            // 为不同元素添加适当的分隔符
            switch (tagName) {
                case 'h1':
                case 'h2':
                case 'h3':
                case 'h4':
                case 'h5':
                case 'h6':
                    result += '\n\n# ';
                    break;
                case 'p':
                case 'div':
                    if (node.textContent.trim()) {
                        result += '\n\n';
                    }
                    break;
                case 'br':
                    result += '\n';
                    return; // br元素不需要处理子节点
                case 'li':
                    result += '\n• ';
                    break;
                case 'blockquote':
                    result += '\n> ';
                    break;
                case 'pre':
                case 'code':
                    result += '\n```\n';
                    break;
                case 'table':
                    result += '\n\n[表格内容]\n';
                    break;
                case 'img':
                    const alt = node.getAttribute('alt');
                    if (alt) {
                        result += `[图片: ${alt}] `;
                    }
                    return; // img元素不需要处理子节点
                case 'a':
                    const href = node.getAttribute('href');
                    if (href && !href.startsWith('#')) {
                        // 处理链接文本
                        const linkText = node.textContent.trim();
                        if (linkText) {
                            result += `[${linkText}]`;
                        }
                        return; // 已处理链接文本，不需要递归
                    }
                    break;
                case 'time':
                case 'relative-time':
                    // 处理时间元素，优先使用datetime属性中的完整时间信息
                    const datetime = node.getAttribute('datetime');
                    const title = node.getAttribute('title');
                    const textContent = node.textContent.trim();
                    
                    if (datetime) {
                        // 如果有datetime属性，使用完整的ISO时间格式
                        result += `${textContent} (${datetime})`;
                    } else if (title) {
                        // 如果有title属性，也包含进去
                        result += `${textContent} (${title})`;
                    } else {
                        // 否则只使用文本内容
                        result += textContent;
                    }
                    result += ' ';
                    return; // 时间元素不需要递归处理子节点
                    break;
            }
            
            // 递归处理子节点
            for (const child of node.childNodes) {
                processNode(child);
            }
            
            // 某些元素后添加换行
            if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre'].includes(tagName)) {
                if (node.textContent.trim()) {
                    result += '\n';
                }
            }
            
            if (tagName === 'pre' || tagName === 'code') {
                result += '\n```\n';
            }
        }
    }
    
    processNode(element);
    
    return result;
}

/**
 * 过滤无关内容，保留有价值的文本
 * @param {string} text 原始文本
 * @returns {string} 过滤后的文本
 */
function filterRelevantContent(text) {
    const lines = text.split('\n');
    const filteredLines = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // 跳过过短的行
        if (trimmed.length < 2) {
            if (trimmed === '') {
                filteredLines.push(line); // 保留空行用于格式
            }
            continue;
        }
        
        // 跳过可能是导航或菜单的行
        if (/^(首页|主页|关于我们?|联系我们?|登录|注册|搜索|更多|下一页|上一页|返回|回到顶部)$/i.test(trimmed)) {
            continue;
        }
        
        // 跳过版权信息
        if (/copyright|©|版权所有|保留所有权利|all rights reserved/i.test(trimmed)) {
            continue;
        }
        
        // 跳过社交媒体分享文本
        if (/^(分享到|分享|点赞|收藏|转发|微博|微信|QQ|Facebook|Twitter)$/i.test(trimmed)) {
            continue;
        }
        
        // 跳过广告相关文本
        if (/^(广告|推广|赞助|Advertisement|Sponsored)$/i.test(trimmed)) {
            continue;
        }
        
        filteredLines.push(line);
    }
    
    return filteredLines.join('\n');
}

/**
 * 加载HTML模板
 * @param {string} templateId 模板ID
 * @returns {Promise<DocumentFragment>} 模板内容
 */
async function loadTemplate(templateId) {
    try {
        // 检查是否已经加载了模板
        let templateContainer = document.getElementById('webchat-templates');
        if (!templateContainer) {
            // 加载外部HTML文件
            const response = await fetch(chrome.runtime.getURL('content/content.html'));
            const htmlText = await response.text();
            
            // 创建临时容器来解析HTML
            templateContainer = document.createElement('div');
            templateContainer.id = 'webchat-templates';
            templateContainer.style.display = 'none';
            templateContainer.innerHTML = htmlText;
            document.head.appendChild(templateContainer);
        }
        
        const template = templateContainer.querySelector(`#${templateId}`);
        if (!template) {
            throw new Error(`Template ${templateId} not found`);
        }
        
        return template.content.cloneNode(true);
    } catch (error) {
        console.error('Failed to load template:', error);
        // 降级到内联模板
        return createFallbackTemplate(templateId);
    }
}

/**
 * 创建降级模板（当外部模板加载失败时使用）
 * @param {string} templateId 模板ID
 * @returns {DocumentFragment} 模板内容
 */
function createFallbackTemplate(templateId) {
    const fragment = document.createDocumentFragment();
    const div = document.createElement('div');
    
    if (templateId === 'dialog-template') {
        div.innerHTML = `
            <div class="container">
                <div class="header">
                    <div class="header-title">Web Chat</div>
                    <div class="header-controls">
                        <button id="pinButton" class="header-btn" title="置顶">📌</button>
                        <button id="resetSizeButton" class="header-btn" title="恢复默认窗口大小">⚏</button>
                        <button id="closeButton" class="header-btn" title="关闭">✕</button>
                    </div>
                </div>
                <div id="chat-container" class="chat-container">
                    <div id="messages" class="messages"></div>
                </div>
                <div class="input-container">
                    <textarea id="userInput" placeholder="请输入您的问题..." rows="2"></textarea>
                    <button id="askButton" class="send-button"></button>
                </div>
            </div>
            <div class="resize-handle resize-se"></div>
            <div class="resize-handle resize-n"></div>
            <div class="resize-handle resize-s"></div>
            <div class="resize-handle resize-w"></div>
            <div class="resize-handle resize-e"></div>
            <div class="resize-handle resize-nw"></div>
            <div class="resize-handle resize-ne"></div>
            <div class="resize-handle resize-sw"></div>
        `;
    } else if (templateId === 'ball-icon-template') {
        div.innerHTML = '💬';
    } else if (templateId === 'settings-icon-template') {
        div.innerHTML = '⚙️';
    }
    
    fragment.appendChild(div);
    return fragment;
}

/**
 * 创建AI助手对话框
 * 包含标题栏、消息容器、输入框和调整大小手柄
 * 支持拖拽移动和调整大小功能
 * @returns {Promise<HTMLElement>} 创建的对话框元素
 */
async function createDialog() {
    const existingDialog = document.getElementById('ai-assistant-dialog');
    if (existingDialog) {
        existingDialog.remove();
    }

    const dialog = document.createElement('div');
    dialog.id = 'ai-assistant-dialog';
    
    // 使用外部模板
    const template = await loadTemplate('dialog-template');
    dialog.appendChild(template);

    const container = dialog.querySelector('.container');
    const header = dialog.querySelector('.header');

    let isDragging = false;
    let dragCurrentX;
    let dragCurrentY;
    let dragInitialX;
    let dragInitialY;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    document.body.appendChild(overlay);

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.toggle-ball') || e.target.closest('.header-btn')) return;

        isDragging = true;
        dialog.style.transition = 'none';
        const rect = dialog.getBoundingClientRect();
        dragInitialX = e.clientX - rect.left;
        dragInitialY = e.clientY - rect.top;

        overlay.classList.add('dragging');
    });

    let dragAnimationFrame;
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();

            if (dragAnimationFrame) {
                cancelAnimationFrame(dragAnimationFrame);
            }

            dragAnimationFrame = requestAnimationFrame(() => {
                dragCurrentX = e.clientX - dragInitialX;
                dragCurrentY = e.clientY - dragInitialY;

                const maxX = window.innerWidth - dialog.offsetWidth;
                const maxY = window.innerHeight - dialog.offsetHeight;

                dragCurrentX = Math.max(0, Math.min(dragCurrentX, maxX));
                dragCurrentY = Math.max(0, Math.min(dragCurrentY, maxY));

                dialog.style.left = `${dragCurrentX}px`;
                dialog.style.top = `${dragCurrentY}px`;
            });
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            dialog.style.transition = '';

            overlay.classList.remove('dragging');

            if (dragAnimationFrame) {
                cancelAnimationFrame(dragAnimationFrame);
            }

            chrome.storage.sync.set({
                dialogPosition: {
                    left: dialog.style.left,
                    top: dialog.style.top,
                    right: dialog.style.right,
                    bottom: dialog.style.bottom,
                    isCustomPosition: true
                }
            });
        }
    });

    chrome.storage.sync.get({
        dialogPosition: {
            left: 'auto',
            top: 'auto',
            right: '80px',
            bottom: '20px',
            isCustomPosition: false
        }
    }, (items) => {
        if (items.dialogPosition.isCustomPosition) {
            if (items.dialogPosition.left !== 'auto') {
                dialog.style.left = items.dialogPosition.left;
                dialog.style.right = 'auto';
            } else if (items.dialogPosition.right !== 'auto') {
                dialog.style.right = items.dialogPosition.right;
                dialog.style.left = 'auto';
            }
            
            if (items.dialogPosition.top !== 'auto') {
                dialog.style.top = items.dialogPosition.top;
                dialog.style.bottom = 'auto';
            } else if (items.dialogPosition.bottom !== 'auto') {
                dialog.style.bottom = items.dialogPosition.bottom;
                dialog.style.top = 'auto';
            }
        }
    });

    // 缩放功能实现
    const resizeHandles = dialog.querySelectorAll('.resize-handle');
    let currentResizeType = null;
    let resizeInitialRect = null;

    resizeHandles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            dialog.style.transition = 'none';
            
            // 获取缩放类型
            currentResizeType = handle.classList[1]; // resize-se, resize-n, etc.
            
            // 记录初始状态
            const rect = dialog.getBoundingClientRect();
            resizeInitialRect = {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
            };
            resizeInitialX = e.clientX;
            resizeInitialY = e.clientY;

            document.addEventListener('mousemove', handleResize);
            document.addEventListener('mouseup', stopResize);

            e.preventDefault();
            e.stopPropagation();
        });
    });

    let resizeAnimationFrame;
    function handleResize(e) {
        if (!isResizing || !currentResizeType) return;

        if (resizeAnimationFrame) {
            cancelAnimationFrame(resizeAnimationFrame);
        }

        resizeAnimationFrame = requestAnimationFrame(() => {
            const deltaX = e.clientX - resizeInitialX;
            const deltaY = e.clientY - resizeInitialY;
            
            let newLeft = resizeInitialRect.left;
            let newTop = resizeInitialRect.top;
            let newWidth = resizeInitialRect.width;
            let newHeight = resizeInitialRect.height;

            // 根据缩放类型计算新的尺寸和位置
            switch (currentResizeType) {
                case 'resize-se': // 右下角
                    newWidth = resizeInitialRect.width + deltaX;
                    newHeight = resizeInitialRect.height + deltaY;
                    break;
                case 'resize-nw': // 左上角
                    newLeft = resizeInitialRect.left + deltaX;
                    newTop = resizeInitialRect.top + deltaY;
                    newWidth = resizeInitialRect.width - deltaX;
                    newHeight = resizeInitialRect.height - deltaY;
                    break;
                case 'resize-ne': // 右上角
                    newTop = resizeInitialRect.top + deltaY;
                    newWidth = resizeInitialRect.width + deltaX;
                    newHeight = resizeInitialRect.height - deltaY;
                    break;
                case 'resize-sw': // 左下角
                    newLeft = resizeInitialRect.left + deltaX;
                    newWidth = resizeInitialRect.width - deltaX;
                    newHeight = resizeInitialRect.height + deltaY;
                    break;
                case 'resize-n': // 上边
                    newTop = resizeInitialRect.top + deltaY;
                    newHeight = resizeInitialRect.height - deltaY;
                    break;
                case 'resize-s': // 下边
                    newHeight = resizeInitialRect.height + deltaY;
                    break;
                case 'resize-w': // 左边
                    newLeft = resizeInitialRect.left + deltaX;
                    newWidth = resizeInitialRect.width - deltaX;
                    break;
                case 'resize-e': // 右边
                    newWidth = resizeInitialRect.width + deltaX;
                    break;
            }

            // 应用最小尺寸限制
            if (newWidth < RESIZE_MIN_WIDTH) {
                if (currentResizeType.includes('w')) {
                    newLeft = resizeInitialRect.left + resizeInitialRect.width - RESIZE_MIN_WIDTH;
                }
                newWidth = RESIZE_MIN_WIDTH;
            }
            if (newHeight < RESIZE_MIN_HEIGHT) {
                if (currentResizeType.includes('n')) {
                    newTop = resizeInitialRect.top + resizeInitialRect.height - RESIZE_MIN_HEIGHT;
                }
                newHeight = RESIZE_MIN_HEIGHT;
            }

            // 边界检查
            const maxWidth = window.innerWidth - newLeft - 20;
            const maxHeight = window.innerHeight - newTop - 20;
            
            if (newLeft < 20) {
                if (currentResizeType.includes('w')) {
                    newWidth = newWidth - (20 - newLeft);
                    newLeft = 20;
                }
            }
            if (newTop < 20) {
                if (currentResizeType.includes('n')) {
                    newHeight = newHeight - (20 - newTop);
                    newTop = 20;
                }
            }
            
            newWidth = Math.min(newWidth, maxWidth);
            newHeight = Math.min(newHeight, maxHeight);

            // 应用新的尺寸和位置
            dialog.style.left = `${newLeft}px`;
            dialog.style.top = `${newTop}px`;
            dialog.style.width = `${newWidth}px`;
            dialog.style.height = `${newHeight}px`;

            // 保存到存储
            chrome.storage.sync.set({
                dialogSize: {
                    width: newWidth,
                    height: newHeight
                },
                dialogPosition: {
                    left: `${newLeft}px`,
                    top: `${newTop}px`,
                    right: 'auto',
                    bottom: 'auto',
                    isCustomPosition: true
                }
            });
        });
    }

    function stopResize() {
        if (isResizing) {
            isResizing = false;
            currentResizeType = null;
            resizeInitialRect = null;
            dialog.style.transition = '';
            document.removeEventListener('mousemove', handleResize);
            document.removeEventListener('mouseup', stopResize);

            if (resizeAnimationFrame) {
                cancelAnimationFrame(resizeAnimationFrame);
            }
        }
    }

    chrome.storage.sync.get({
        dialogSize: {
            width: 400,
            height: 500
        }
    }, (items) => {
        dialog.style.width = `${items.dialogSize.width}px`;
        dialog.style.height = `${items.dialogSize.height}px`;
    });

    document.body.appendChild(dialog);

    // 添加按钮事件监听器
    const pinButton = dialog.querySelector('#pinButton');
    const resetSizeButton = dialog.querySelector('#resetSizeButton');
    const closeButton = dialog.querySelector('#closeButton');
    
    // 置顶按钮功能
    let isPinned = false;
    if (pinButton) {
        // 从存储中获取置顶状态
        chrome.storage.sync.get({ dialogPinned: false }, (items) => {
            isPinned = items.dialogPinned;
            updatePinButtonState();
        });
        
        pinButton.addEventListener('click', (e) => {
            e.stopPropagation();
            isPinned = !isPinned;
            chrome.storage.sync.set({ 
                dialogPinned: isPinned
            });
            updatePinButtonState();
        });
    }
    
    function updatePinButtonState() {
        if (pinButton) {
            pinButton.style.opacity = isPinned ? '1' : '0.7';
            pinButton.style.backgroundColor = isPinned ? 'rgba(255, 255, 255, 0.3)' : 'transparent';
            pinButton.title = isPinned ? '取消置顶' : '置顶';
        }
    }
    
    // 恢复默认大小按钮功能
    if (resetSizeButton) {
        resetSizeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // 恢复默认尺寸
            dialog.style.width = '500px';
            dialog.style.height = '500px';
            
            // 基于最右下角定位：悬浮球贴右边，对话窗口贴最下方和悬浮球
            dialog.style.left = 'auto';
            dialog.style.top = 'auto';
            dialog.style.right = '80px'; // 悬浮球宽度(60px) + 间距(20px)
            dialog.style.bottom = '20px'; // 与悬浮球底部对齐
            
            // 同时恢复悬浮球到默认位置（右下角）
            const ballContainer = document.querySelector('.ball-container');
            if (ballContainer) {
                ballContainer.style.right = '20px';
                ballContainer.style.bottom = '20px';
                ballContainer.style.left = 'auto';
                ballContainer.style.top = 'auto';
                
                // 移除边缘状态
                const ball = ballContainer.querySelector('#ai-assistant-ball');
                if (ball) {
                    ball.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');
                }
                
                // 保存悬浮球位置
                chrome.storage.sync.set({
                    ballPosition: { right: '20px', bottom: '20px', left: 'auto', top: 'auto', edge: null }
                });
            }
            
            // 保存默认设置
            chrome.storage.sync.set({
                dialogSize: { width: 500, height: 500 },
                dialogPosition: { left: 'auto', top: 'auto', right: '80px', bottom: '20px', isCustomPosition: false }
            });
        });
    }
    
    // 关闭按钮功能
    if (closeButton) {
        closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            dialog.classList.remove('show');
        });
    }

    document.addEventListener('mousedown', async (e) => {
        const ball = document.getElementById('ai-assistant-ball');

        const settings = await chrome.storage.sync.get({
            dialogPinned: false
        });

        // 如果对话框被置顶，则不自动隐藏
        if (!settings.dialogPinned &&
            dialog.classList.contains('show') &&
            !dialog.contains(e.target) &&
            (!ball || !ball.contains(e.target))) {
            dialog.classList.remove('show');
        }
    });

    return dialog;
}

/**
 * 创建悬浮球组件
 * 包含主球体和设置按钮，支持拖拽移动和边缘吸附
 * 点击球体可显示/隐藏对话框
 * @returns {HTMLElement} 创建的悬浮球元素
 */
async function createFloatingBall() {
    const container = document.createElement('div');
    container.className = 'ball-container';

    const ball = document.createElement('div');
    ball.id = 'ai-assistant-ball';
    
    // 使用外部模板加载球体图标
    try {
        const ballIconTemplate = await loadTemplate('ball-icon-template');
        ball.appendChild(ballIconTemplate);
    } catch (error) {
        console.error('Failed to load ball icon template:', error);
        // 降级到简单文本图标
        ball.innerHTML = '💬';
        ball.style.fontSize = '24px';
        ball.style.display = 'flex';
        ball.style.alignItems = 'center';
        ball.style.justifyContent = 'center';
    }

    const settingsButton = document.createElement('div');
    settingsButton.className = 'settings-button';
    
    // 使用外部模板加载设置图标
    try {
        const settingsIconTemplate = await loadTemplate('settings-icon-template');
        settingsButton.appendChild(settingsIconTemplate);
    } catch (error) {
        console.error('Failed to load settings icon template:', error);
        // 降级到简单文本图标
        settingsButton.innerHTML = '⚙️';
        settingsButton.style.fontSize = '16px';
        settingsButton.style.display = 'flex';
        settingsButton.style.alignItems = 'center';
        settingsButton.style.justifyContent = 'center';
    }
    settingsButton.title = '设置';

    let dialog = document.getElementById('ai-assistant-dialog');
    if (!dialog) {
        dialog = await createDialog();
        initializeDialog(dialog);
    }

    settingsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'openOptions' });
    });

    ball.addEventListener('click', () => {
        const isVisible = dialog.classList.contains('show');
        if (!isVisible) {
            const ballRect = ball.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            const dialogWidth = dialog.offsetWidth || 400;
            const dialogHeight = dialog.offsetHeight || 500;

            let left = ballRect.left - dialogWidth - 20;
            let top = Math.min(
                ballRect.top,
                windowHeight - dialogHeight - 20
            );

            if (left < 20) {
                left = ballRect.right + 20;

                if (left + dialogWidth > windowWidth - 20) {
                    if (ballRect.left > windowWidth / 2) {
                        left = 20;
                    } else {
                        left = windowWidth - dialogWidth - 20;
                    }
                }
            }

            if (top < 20) {
                top = Math.min(
                    ballRect.bottom + 20,
                    windowHeight - dialogHeight - 20
                );
            }

            left = Math.max(20, Math.min(left, windowWidth - dialogWidth - 20));
            top = Math.max(20, Math.min(top, windowHeight - dialogHeight - 20));

            dialog.style.left = `${left}px`;
            dialog.style.top = `${top}px`;
            dialog.style.right = 'auto';
            dialog.style.bottom = 'auto';

            dialog.classList.add('show');
        } else {
            dialog.classList.remove('show');
        }
    });

    container.appendChild(ball);
    container.appendChild(settingsButton);

    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    ball.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = container.getBoundingClientRect();
        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            const maxX = window.innerWidth - container.offsetWidth;
            const maxY = window.innerHeight - container.offsetHeight;
            const edgeThreshold = ball.offsetWidth / 2;

            ball.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');

            let position = {};
            if (currentX <= edgeThreshold) {
                currentX = 0;
                ball.classList.add('edge-left');
                position = {
                    left: '0px',
                    top: `${currentY}px`,
                    right: 'auto',
                    bottom: 'auto',
                    edge: 'left'
                };
            } else if (currentX >= maxX - edgeThreshold) {
                currentX = maxX;
                ball.classList.add('edge-right');
                position = {
                    right: '0px',
                    top: `${currentY}px`,
                    left: 'auto',
                    bottom: 'auto',
                    edge: 'right'
                };
            } else if (currentY <= edgeThreshold) {
                currentY = 0;
                ball.classList.add('edge-top');
                position = {
                    top: '0px',
                    left: `${currentX}px`,
                    right: 'auto',
                    bottom: 'auto',
                    edge: 'top'
                };
            } else if (currentY >= maxY - edgeThreshold) {
                currentY = maxY;
                ball.classList.add('edge-bottom');
                position = {
                    bottom: '0px',
                    left: `${currentX}px`,
                    right: 'auto',
                    top: 'auto',
                    edge: 'bottom'
                };
            } else {
                position = {
                    left: `${currentX}px`,
                    top: `${currentY}px`,
                    right: 'auto',
                    bottom: 'auto',
                    edge: null
                };
            }

            Object.assign(container.style, position);

            chrome.storage.sync.set({
                ballPosition: position
            });
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    chrome.storage.sync.get({
        ballPosition: { right: '20px', bottom: '20px', left: 'auto', top: 'auto', edge: null }
    }, (items) => {
        const containerRect = container.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        let position = items.ballPosition;
        let left = position.left !== 'auto' ? parseInt(position.left) : null;
        let right = position.right !== 'auto' ? parseInt(position.right) : null;
        let top = position.top !== 'auto' ? parseInt(position.top) : null;
        let bottom = position.bottom !== 'auto' ? parseInt(position.bottom) : null;

        if (left !== null) {
            left = Math.min(Math.max(0, left), windowWidth - containerRect.width);
            position = {
                left: `${left}px`,
                top: position.top,
                right: 'auto',
                bottom: position.bottom,
                edge: position.edge
            };
        } else if (right !== null) {
            right = Math.min(Math.max(0, right), windowWidth - containerRect.width);
            position = {
                right: `${right}px`,
                top: position.top,
                left: 'auto',
                bottom: position.bottom,
                edge: position.edge
            };
        }

        if (top !== null) {
            top = Math.min(Math.max(0, top), windowHeight - containerRect.height);
            position = {
                ...position,
                top: `${top}px`,
                bottom: 'auto'
            };
        } else if (bottom !== null) {
            bottom = Math.min(Math.max(0, bottom), windowHeight - containerRect.height);
            position = {
                ...position,
                bottom: `${bottom}px`,
                top: 'auto'
            };
        }

        Object.assign(container.style, position);

        if (position.edge) {
            ball.classList.add(`edge-${position.edge}`);
        }

        chrome.storage.sync.set({ ballPosition: position });
    });

    window.addEventListener('resize', () => {
        const rect = container.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        let left = rect.left;
        let top = rect.top;
        if (left + rect.width > windowWidth) {
            left = windowWidth - rect.width;
        }
        if (top + rect.height > windowHeight) {
            top = windowHeight - rect.height;
        }

        left = Math.max(0, left);
        top = Math.max(0, top);

        const position = {
            left: `${left}px`,
            top: `${top}px`,
            right: 'auto',
            bottom: 'auto',
            edge: null
        };

        Object.assign(container.style, position);

        chrome.storage.sync.set({ ballPosition: position });

        const edgeThreshold = ball.offsetWidth / 2;
        ball.classList.remove('edge-left', 'edge-right', 'edge-top', 'edge-bottom');

        if (left <= edgeThreshold) {
            ball.classList.add('edge-left');
            position.edge = 'left';
        } else if (left >= windowWidth - rect.width - edgeThreshold) {
            ball.classList.add('edge-right');
            position.edge = 'right';
        }

        if (top <= edgeThreshold) {
            ball.classList.add('edge-top');
            position.edge = 'top';
        } else if (top >= windowHeight - rect.height - edgeThreshold) {
            ball.classList.add('edge-bottom');
            position.edge = 'bottom';
        }

        chrome.storage.sync.set({ ballPosition: position });
    });

    document.body.appendChild(container);
    return ball;
}

// 全局变量声明
let dialogInstance = null;  // 对话框实例
let ballInstance = null;    // 悬浮球实例

// 缩放控制全局变量
const RESIZE_MIN_WIDTH = 500;   // 最小宽度
const RESIZE_MIN_HEIGHT = 400;  // 最小高度
/**
 * 初始化Marked.js库用于Markdown渲染
 * 等待库加载完成并配置渲染选项
 * @returns {Function} Markdown解析函数，失败时返回原文本函数
 */
async function initMarked() {
    try {
        if (typeof marked === 'undefined') {
            await new Promise((resolve, reject) => {
                const checkMarked = () => {
                    if (typeof marked !== 'undefined') {
                        resolve();
                    } else {
                        setTimeout(checkMarked, 100);
                    }
                };
                checkMarked();
                setTimeout(() => reject(new Error('Marked加载超时')), 5000);
            });
        }

        marked.setOptions({
            breaks: true,
            gfm: true,
            headerIds: false,
            mangle: false
        });

        return marked.parse;
    } catch (error) {
        console.error('Marked初始化失败:', error);
        return text => text;
    }
}

/**
 * 显示页面右上角通知消息
 * 自动移除已存在的通知，显示新通知3秒后自动消失
 * @param {string} message - 要显示的通知消息
 */
function showNotification(message) {
    const existingNotification = document.querySelector('.extension-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'extension-notification';
    notification.style.cssText = `
        position: fixed;
        right: 20px;
        top: 20px;
        padding: 10px 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        border-radius: 4px;
        z-index: 1001;
        font-size: 14px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        animation: fadeInOut 3s ease forwards;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

/**
 * 带重试机制的消息发送函数
 * 处理扩展上下文失效等错误情况，支持指数退避重试
 * @param {Object} message - 要发送的消息对象
 * @param {number} maxRetries - 最大重试次数，默认3次
 * @returns {Promise} 发送结果或undefined（扩展失效时）
 */
async function sendMessageWithRetry(message, maxRetries = 3) {
    let notificationShown = false;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await chrome.runtime.sendMessage(message);
        } catch (error) {
            if (error.message.includes('Extension context invalidated')) {
                if (!notificationShown) {
                    console.log('Extension context invalidated, reloading page...');
                    const notification = document.createElement('div');
                    notification.style.cssText = `
                        position: fixed;
                        right: 20px;
                        top: 20px;
                        padding: 10px 20px;
                        background: rgba(0, 0, 0, 0.8);
                        color: white;
                        border-radius: 4px;
                        z-index: 1001;
                        font-size: 14px;
                        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
                    `;
                    notification.textContent = '扩展已更新，请刷新页面以继续使用';
                    document.body.appendChild(notification);

                    setTimeout(() => {
                        notification.remove();
                    }, 3000);

                    notificationShown = true;
                }
                return;
            }
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
        }
    }
}

// 全局错误处理 - 防止扩展上下文失效错误显示给用户
window.addEventListener('error', (event) => {
    if (event.error && event.error.message.includes('Extension context invalidated')) {
        event.preventDefault();
    }
});

// 处理未捕获的Promise拒绝
window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message &&
        event.reason.message.includes('Extension context invalidated')) {
        event.preventDefault();
    }
});

/**
 * 检查并设置悬浮球和对话框的可见性
 * 确保UI组件正确初始化，处理扩展上下文失效情况
 */
async function checkAndSetBallVisibility() {
    try {
        if (!chrome.runtime) {
            showNotification('扩展已更新，请刷新页面以继续使用');
            return;
        }
        const existingBall = document.getElementById('ai-assistant-ball');
        const existingDialog = document.getElementById('ai-assistant-dialog');

        if (!existingBall) {
            await createFloatingBall();
        } else if (!existingDialog) {
            const dialog = await createDialog();
            initializeDialog(dialog);
        }
    } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
            showNotification('扩展已更新，请刷新页面以继续使用');
        }
    }
}

/**
 * Chrome扩展消息监听器
 * 处理来自background script的各种消息请求
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
        if (request.action === 'ping') {
            sendResponse({ status: 'ok' });
        } else if (request.action === 'getPageContent') {
            const content = parseWebContent();
            sendResponse({ content });
        } else if (request.action === 'toggleFloatingBall') {
            checkAndSetBallVisibility();
            sendResponse({ status: 'ok' });
        }
    } catch (error) {
        console.error('处理消息时出错:', error);
        sendResponse({ error: error.message });
    }
    return true;
});

/**
 * 页面导航检测和初始化
 * 检测页面导航类型，清空历史记录以确保不同网页的初始状态一致
 */
const navigationEntries = performance.getEntriesByType('navigation');
if (navigationEntries.length > 0) {
    const navigationType = navigationEntries[0].type;
    // 对于reload、navigate类型都清空历史记录，确保不同网页初始状态一致
    if (navigationType === 'reload' || navigationType === 'navigate') {
        chrome.runtime.sendMessage({ action: 'clearCurrentTabHistory' });
    }
}

// 初始化悬浮球和对话框
checkAndSetBallVisibility();

/**
 * 初始化对话框功能
 * 设置消息处理、滚动控制、历史记录加载等核心功能
 * @param {HTMLElement} dialog - 对话框DOM元素
 */
async function initializeDialog(dialog) {
    try {
        const userInput = dialog.querySelector('#userInput');
        const askButton = dialog.querySelector('#askButton');
        const messagesContainer = dialog.querySelector('#messages');
        const chatContainer = dialog.querySelector('#chat-container');
        let isGenerating = false;
        let currentPort = null;
        let currentAnswer = '';
        let userHasScrolled = false;

        /**
         * 自动滚动到消息容器底部
         * 只在用户未手动滚动或强制滚动时执行
         * @param {boolean} force - 是否强制滚动，忽略用户滚动状态
         */
        function autoScroll(force = false) {
            const messagesContainer = document.querySelector('#ai-assistant-dialog .messages');
            if (!messagesContainer) return;

            if (force || !userHasScrolled) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        const messages = messagesContainer.children;
                        if (messages.length > 0) {
                            const lastMessage = messages[messages.length - 1];
                            lastMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
                        }
                    });
                });
            }
        }

        messagesContainer.addEventListener('scroll', () => {
            if (!isGenerating) {
                const isAtBottom = Math.abs(
                    messagesContainer.scrollHeight -
                    messagesContainer.clientHeight -
                    messagesContainer.scrollTop
                ) < 30;

                userHasScrolled = !isAtBottom;
            }
        });

        const observer = new MutationObserver((mutations) => {
            let shouldScroll = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    shouldScroll = true;
                    break;
                }
            }
            if (shouldScroll) {
                autoScroll();
            }
        });

        observer.observe(messagesContainer, {
            childList: true,
            subtree: true,
            characterData: true
        });

        const dialogObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.target.classList.contains('show')) {
                    userHasScrolled = false;
                    autoScroll(true);
                }
            });
        });

        dialogObserver.observe(dialog, {
            attributes: true,
            attributeFilter: ['class']
        });

        let tabId;
        try {
            const response = await sendMessageWithRetry({ action: 'getCurrentTab' });
            if (!response) throw new Error('无法获取标签页ID');
            tabId = response.tabId;
        } catch (error) {
            console.error('获取标签页ID失败:', error);
            return;
        }

        const markedInstance = await initMarked();

        /**
         * 加载当前标签页的聊天历史记录
         * 如果没有历史记录则显示欢迎消息
         */
        async function loadHistory() {
            try {
                const response = await sendMessageWithRetry({ action: 'getHistory', tabId });
                messagesContainer.innerHTML = '';

                if (!response || !response.history || response.history.length === 0) {
                    const welcomeDiv = document.createElement('div');
                    welcomeDiv.className = 'welcome-message';
                    welcomeDiv.innerHTML = '<p>👋 你好！我是AI助手，可以帮你理解和分析当前网页的内容。</p>';
                    messagesContainer.appendChild(welcomeDiv);
                } else {
                    response.history.forEach(msg => {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = `message ${msg.isUser ? 'user-message' : 'assistant-message'}`;
                        messageDiv.dataset.markdownContent = msg.markdownContent || msg.content;

                        try {
                            messageDiv.innerHTML = markedInstance(msg.markdownContent || msg.content);
                        } catch (error) {
                            console.error('Markdown渲染失败:', error);
                            messageDiv.textContent = msg.content;
                        }

                        messagesContainer.appendChild(messageDiv);
                    });
                }
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            } catch (error) {
                console.error('加载历史记录失败:', error);
                messagesContainer.innerHTML = '<div class="welcome-message"><p>👋 你好！我是AI助手，可以帮你理解和分析当前网页的内容。</p></div>';
            }
        }

        /**
         * 添加消息到聊天容器
         * 支持用户消息和AI回复，自动处理Markdown渲染
         * @param {string} content - 消息内容
         * @param {boolean} isUser - 是否为用户消息
         * @returns {HTMLElement} 创建的消息元素
         */
        function addMessage(content, isUser = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isUser ? 'user-message' : 'assistant-message'}`;

            if (!isUser && content === '') {
                messageDiv.setAttribute('data-pending', 'true');
            } else {
                messageDiv.dataset.markdownContent = content;
                try {
                    messageDiv.innerHTML = markedInstance(content);
                } catch (error) {
                    console.error('Markdown渲染失败:', error);
                    messageDiv.textContent = content;
                }
            }

            messagesContainer.appendChild(messageDiv);
            autoScroll();
            return messageDiv;
        }

        /**
         * 添加AI正在输入的动画指示器
         * @returns {HTMLElement} 创建的打字指示器元素
         */
        function addTypingIndicator() {
            const indicatorDiv = document.createElement('div');
            indicatorDiv.className = 'message assistant-message typing-indicator';
            indicatorDiv.innerHTML = '<span></span><span></span><span></span>';
            messagesContainer.appendChild(indicatorDiv);
            autoScroll();
            return indicatorDiv;
        }

        /**
         * 处理用户输入和AI回复生成
         * 支持停止正在进行的生成，处理流式回复
         */
        async function handleUserInput() {
            if (isGenerating) {
                if (currentPort) {
                    currentPort.disconnect();
                    currentPort = null;
                }
                isGenerating = false;
                userInput.disabled = false;
                askButton.disabled = false;
                askButton.classList.remove('generating');
                userInput.focus();

                const pendingMessage = document.querySelector('.message[data-pending="true"]');
                const typingIndicator = document.querySelector('.typing-indicator');
                
                // 保留当前已生成的内容，只移除pending状态和打字指示器
                if (pendingMessage) {
                    pendingMessage.removeAttribute('data-pending');
                    // 如果消息有内容，则保留；如果没有内容，则移除
                    if (!pendingMessage.textContent.trim()) {
                        pendingMessage.remove();
                        addMessage('已停止回复', false);
                    }
                }
                if (typingIndicator) typingIndicator.remove();

                return;
            }

            const question = userInput.value.trim();
            if (!question) return;

            isGenerating = true;
            userInput.disabled = true;
            askButton.disabled = false;
            askButton.classList.add('generating');
            userInput.value = '';

            try {
                const pageContent = parseWebContent();
                addMessage(question, true);
                const messageDiv = addMessage('', false);
                const typingIndicator = addTypingIndicator();

                if (currentPort) currentPort.disconnect();
                currentPort = chrome.runtime.connect({ name: "answerStream" });
                let currentAnswer = '';

                currentPort.onMessage.addListener(async (msg) => {
                    try {
                        if (msg.type === 'answer-chunk') {
                            currentAnswer += msg.content;
                            try {
                                messageDiv.dataset.markdownContent = msg.markdownContent || currentAnswer;
                                messageDiv.innerHTML = markedInstance(currentAnswer);
                            } catch (error) {
                                messageDiv.textContent = currentAnswer;
                            }
                            autoScroll();
                        } else if (msg.type === 'answer-end') {
                            messageDiv.removeAttribute('data-pending');
                            messageDiv.dataset.markdownContent = msg.markdownContent || currentAnswer;

                            isGenerating = false;
                            userInput.disabled = false;
                            askButton.classList.remove('generating');
                            userInput.focus();
                            typingIndicator.remove();
                            currentPort.disconnect();
                            currentPort = null;
                            currentAnswer = '';
                            userHasScrolled = false;
                            autoScroll(true);
                        } else if (msg.type === 'error') {
                            messageDiv.remove();
                            addMessage('发生错误：' + msg.error, false);
                            isGenerating = false;
                            userInput.disabled = false;
                            askButton.classList.remove('generating');
                            userInput.focus();
                            typingIndicator.remove();
                            currentPort.disconnect();
                            currentPort = null;
                            currentAnswer = '';
                            userHasScrolled = false;
                        }
                    } catch (error) {
                        console.error('处理消息时出错:', error);
                    }
                });

                try {
                    currentPort.postMessage({
                        action: 'generateAnswer',
                        tabId: tabId,
                        pageContent: pageContent,
                        question: question
                    });
                } catch (error) {
                    console.error('发送消息失败:', error);
                    throw error;
                }

            } catch (error) {
                addMessage('发生错误：' + error.message, false);
                isGenerating = false;
                userInput.disabled = false;
                askButton.classList.remove('generating');
                userInput.focus();
            }
        }

        askButton.addEventListener('click', handleUserInput);
        userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleUserInput();
            }
        });

        userInput.addEventListener('input', () => {
            userInput.style.height = 'auto';
            userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';
        });

        await loadHistory();
    } catch (error) {
        console.error('初始化对话框失败:', error);
        const errorDiv = document.createElement('div');
        errorDiv.className = 'welcome-message';
        errorDiv.innerHTML = '<p>⚠️ 初始化失败，请刷新页面后重试</p>';
        dialog.querySelector('.messages').appendChild(errorDiv);
    }
}

/**
 * 最终错误处理 - 显示用户友好的错误提示
 * 当扩展上下文失效时提醒用户刷新页面
 */
window.addEventListener('error', (event) => {
    if (event.error && event.error.message.includes('Extension context invalidated')) {
        showNotification('扩展已更新，请刷新页面以继续使用');
    }
});