/**
 * 解析网页内容，提取纯文本内容用于AI分析
 * 移除脚本、样式、导航、页脚等非内容元素
 * @returns {string} 清理后的网页文本内容
 */
function parseWebContent() {
    const docClone = document.cloneNode(true);
    const scripts = docClone.querySelectorAll('script');
    const styles = docClone.querySelectorAll('style, link[rel="stylesheet"]');
    const headers = docClone.querySelectorAll('header, nav');
    const footers = docClone.querySelectorAll('footer');
    const chatDialog = docClone.querySelectorAll('#ai-assistant-dialog');

    [...scripts, ...styles, ...headers, ...footers, ...chatDialog].forEach(element => {
        if (element.parentNode) {
            element.parentNode.removeChild(element);
        }
    });

    const mainContent = docClone.querySelector('body');
    const textContent = mainContent ? mainContent.innerText : '';

    return textContent
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 创建AI助手对话框
 * 包含标题栏、消息容器、输入框和调整大小手柄
 * 支持拖拽移动和调整大小功能
 * @returns {HTMLElement} 创建的对话框元素
 */
function createDialog() {
    const existingDialog = document.getElementById('ai-assistant-dialog');
    if (existingDialog) {
        existingDialog.remove();
    }

    const dialog = document.createElement('div');
    dialog.id = 'ai-assistant-dialog';
    dialog.innerHTML = `
        <div class="container">
            <div class="header">
                <div class="header-title">Web Chat</div>
            </div>
            <div id="chat-container" class="chat-container">
                <div id="messages" class="messages"></div>
            </div>
            <div class="input-container">
                <textarea id="userInput" placeholder="请输入您的问题..." rows="2"></textarea>
                <button id="askButton" class="send-button">
                </button>
            </div>
        </div>
        <div class="resize-handle"></div>
    `;

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
        if (e.target.closest('.toggle-ball')) return;

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
                    top: dialog.style.top
                }
            });
        }
    });

    chrome.storage.sync.get({
        dialogPosition: {
            left: 'auto',
            top: 'auto',
            isCustomPosition: false
        }
    }, (items) => {
        if (items.dialogPosition.isCustomPosition) {
            dialog.style.left = items.dialogPosition.left;
            dialog.style.top = items.dialogPosition.top;
        }
    });

    const resizeHandle = dialog.querySelector('.resize-handle');

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        dialog.style.transition = 'none';
        resizeInitialWidth = dialog.offsetWidth;
        resizeInitialHeight = dialog.offsetHeight;
        resizeInitialX = e.clientX;
        resizeInitialY = e.clientY;

        document.addEventListener('mousemove', handleResize);
        document.addEventListener('mouseup', stopResize);

        e.preventDefault();
        e.stopPropagation();
    });

    let resizeAnimationFrame;
    function handleResize(e) {
        if (!isResizing) return;

        if (resizeAnimationFrame) {
            cancelAnimationFrame(resizeAnimationFrame);
        }

        resizeAnimationFrame = requestAnimationFrame(() => {
            const deltaX = e.clientX - resizeInitialX;
            const deltaY = e.clientY - resizeInitialY;

            const newWidth = Math.max(300, resizeInitialWidth + deltaX);
            const newHeight = Math.max(400, resizeInitialHeight + deltaY);

            const rect = dialog.getBoundingClientRect();
            const maxWidth = window.innerWidth - rect.left - 20;
            const maxHeight = window.innerHeight - rect.top - 20;

            const finalWidth = Math.min(newWidth, maxWidth);
            const finalHeight = Math.min(newHeight, maxHeight);

            dialog.style.width = `${finalWidth}px`;
            dialog.style.height = `${finalHeight}px`;

            chrome.storage.sync.set({
                dialogSize: {
                    width: finalWidth,
                    height: finalHeight
                }
            });
        });
    }

    function stopResize() {
        if (isResizing) {
            isResizing = false;
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

    document.addEventListener('mousedown', async (e) => {
        const ball = document.getElementById('ai-assistant-ball');

        const settings = await chrome.storage.sync.get({
            autoHideDialog: true
        });

        if (settings.autoHideDialog &&
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
function createFloatingBall() {
    const container = document.createElement('div');
    container.className = 'ball-container';

    const ball = document.createElement('div');
    ball.id = 'ai-assistant-ball';
    ball.innerHTML = `<svg t="1731757557572" class="icon" width="32" height="32" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1317" width="128" height="128">
        <path d="M200 935.744a39.517867 39.517867 0 0 1-14.122667-7.185067c-12.906667-10.295467-18.602667-27.2896-14.741333-43.4688a1295.863467 1295.863467 0 0 0 17.207467-520c-5.6448-33.216 0.418133-66.760533 17.5488-96.443733 17.156267-29.563733 43.498667-51.648 75.656533-60.497067h0.008533l417.591467-114.24c66.0352-19.434667 144.533333 49.792 162.602667 156.258134a1978.666667 1978.666667 0 0 1 27.144533 397.806933c-3.4432 107.592533-71.6928 186.248533-139.758933 176.008533l-64.823467-8.494933c-22.203733-3.042133-36.8768-29.952-33.8944-60.1984 3.008-30.2336 22.664533-53.713067 45.038933-52.343467 21.7472 1.463467 43.485867 2.922667 65.233067 4.3776 24.170667 1.783467 45.969067-26.0096 47.133867-62.007466a1897.941333 1897.941333 0 0 0-26.030934-381.499734c-6.062933-35.618133-31.466667-60.3136-55.168-55.2576l-424.0128 87.466667c-11.4176 2.363733-21.1584 9.570133-27.6096 20.078933-6.4512 10.530133-8.802133 22.993067-6.698666 35.345067a1377.0368 1377.0368 0 0 1 2.346666 449.117867 1341.696 1341.696 0 0 0 118.4512-104.448c8.251733-8.1792 18.862933-12.475733 29.602134-11.758934l293.009066 19.6736c22.340267 1.365333 38.839467 28.650667 35.639467 60.842667-3.1744 32.200533-24.704 55.765333-46.882133 52.7232l-274.5216-35.972267c-62.229333 57.1136-127.6544 106.965333-194.973867 149.384534-9.629867 6.071467-20.8 7.522133-30.976 4.731733z" p-id="1318" fill="white"></path>
        <path d="M635.733333 488.533333m-59.733333 0a59.733333 59.733333 0 1 0 119.466667 0 59.733333 59.733333 0 1 0-119.466667 0Z" p-id="1319" fill="white"></path>
        <path d="M460.864 507.733333m-50.133333 0a50.133333 50.133333 0 1 0 100.266666 0 50.133333 50.133333 0 1 0-100.266666 0Z" p-id="1320" fill="white"></path>
    </svg>`;

    const settingsButton = document.createElement('div');
    settingsButton.className = 'settings-button';
    settingsButton.innerHTML = '<svg t="1731757768104" class="icon" width="24" height="24" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1612" width="128" height="128"><path d="M550.4 924.404h-49.1c-57.7 0-104.6-46.9-104.6-104.6-0.1-7.2-2.1-14.5-5.9-20.9-6.6-11.2-16.3-18.6-27.9-21.7-11.6-3.1-23.7-1.5-34.1 4.6-51.6 28.6-115.3 10.1-143.2-40.4l-24.5-42.2c-0.1-0.1-0.1-0.2-0.2-0.3v-0.1c-28.5-49.8-11.2-113.5 38.5-142 14-8.1 22.8-23.3 22.8-39.5s-8.7-31.4-22.9-39.6c-49.8-28.8-67-92.8-38.3-142.6l26.6-43.8c28.5-49.3 92.5-66.3 142.3-37.7 6.7 4 14.1 6 21.6 6.1h0.1c24.6 0 45.1-20.2 45.4-45.1 0-57.5 46.7-104.2 104-104.2h49.3c61 1.9 106.4 50.3 104.6 107.9 0.1 6.3 2.1 13.6 5.9 20 6.4 10.8 16.2 18.2 27.9 21.2s23.8 1.2 34.2-4.9c50-28.8 114.1-11.7 143 38l24.5 42.5 1.5 3c26.2 49.3 8.8 111.3-39.7 139.6-7.1 4-12.8 9.7-16.7 16.7-6.4 11.1-7.9 23.3-4.7 34.9 3.2 11.6 10.7 21.3 21.2 27.3 25 14.6 42.1 37.1 49.2 64 7.1 26.9 3.2 54.9-10.8 78.9l-26 43.5c-28.7 49.3-92.6 66.5-142.6 37.8-6.6-3.8-14.3-6-22.1-6.2-12 0.1-23.4 4.9-31.8 13.5-8.5 8.6-13.1 20-13 32-0.4 57.7-47.3 104.3-104.5 104.3z m-199.2-207.6c8.9 0 17.9 1.2 26.7 3.5 26.8 7.1 49.3 24.2 63.2 48.2 9.3 15.7 14.2 33.2 14.4 51 0 25.5 20.5 46 45.7 46h49.1c25 0 45.5-20.4 45.7-45.4-0.2-27.4 10.4-53.6 30-73.4 19.5-19.8 45.6-30.8 73.4-31 19.4 0.5 36.6 5.3 51.7 14 21.9 12.5 49.8 5 62.4-16.7l26.1-43.6c5.9-10.1 7.6-22.3 4.5-34-3.1-11.7-10.5-21.4-20.9-27.5-24.6-14-42-36.4-49.3-63.2-7.3-26.8-3.8-54.9 10-79 9.6-16.8 22.9-30.1 38.9-39.2 21.3-12.4 28.8-40.3 16.5-62-0.5-0.8-0.8-1.6-1.2-2.4l-23.2-40.2c-12.5-21.6-40.5-29.2-62.2-16.7-23.6 14-51.6 17.9-78.5 11.1-26.9-6.9-49.5-23.9-63.7-47.8-9.3-15.7-14.2-33.2-14.4-51.1 0.8-26.4-19-47.5-44.2-48.3h-50.8c-24.9 0-45.1 20.3-45.1 45.2-0.8 57.8-47.7 104.1-104.6 104.1h-0.2c-18.1-0.2-35.5-5.1-50.9-14.2-21.5-12.4-49.4-4.8-62 16.9l-26.6 43.7c-12.1 21.1-4.6 49.1 17.1 61.7 32.2 18.6 52.3 53.3 52.3 90.6s-20.1 72-52.3 90.6c-21.7 12.4-29.2 40.1-16.8 61.7 0 0.1 0.1 0.1 0.1 0.2l24.8 42.8c12.5 22.6 40.3 30.6 62.4 18.5 16-9.3 33.8-14.1 51.9-14.1zM525.9 650.204c-73.3 0-133-59.7-133-133s59.7-133 133-133 133 59.7 133 133c0 73.4-59.7 133-133 133z m0-207c-40.8 0-74.1 33.2-74.1 74.1s33.2 74.1 74.1 74.1 74.1-33.2 74.1-74.1-33.3-74.1-74.1-74.1z" p-id="1613" fill="#ffffff"></path></svg>';
    settingsButton.title = '设置';

    let dialog = document.getElementById('ai-assistant-dialog');
    if (!dialog) {
        dialog = createDialog();
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
        z-index: 10000;
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
                        z-index: 10000;
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
            createFloatingBall();
        } else if (!existingDialog) {
            const dialog = createDialog();
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