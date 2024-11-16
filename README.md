# WebChat：一个AI助手，可以帮你理解和分析当前网页的内容。

基于Chrome扩展的最佳实践开发，AI助手能够基于当前网页内容进行智能问答。支持自定义API和本地大模型。

## 功能特点

- 🤖 基于网页内容的智能问答
- 💬 流式输出回答内容
- 📝 消息渲染支持Markdown格式
- 🛠️ 支持自定义API和本地模型

## 演示视频

<video controls src="https://github.com/Airmomo/WebChat/blob/main/static/WetChat-show.mp4" title="./static/WetChat-show.mp4"></video>

## 安装方法

1. 下载项目代码
2. 打开Chrome扩展管理页面 (chrome://extensions/)
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择项目文件夹

## 基本使用说明

- 插件开启后刷新页面会显示一颗悬浮球，点击它打开对话框
- 输入问题后点击发送并等待AI回答
- 右键点击历史消息可复制内容

## 支持的API

### 自定义API
- 支持OpenAI兼容的API接口
- 可配置自定义端点

### Ollama本地部署开源模型
1. 从[官网](https://ollama.ai)下载安装 Ollama
2. 设置允许跨域并启动：
- macOS：
```bash
launchctl setenv OLLAMA_ORIGINS "*"
```
- Windows：
1. 打开控制面板-系统属性-环境变量
2. 在用户环境变量中新建：
- 变量名：`OLLAMA_HOST`，变量值：`0.0.0.0`
- 变量名：`OLLAMA_ORIGINS`，变量值：`*`
- Linux：
```bash
OLLAMA_ORIGINS="*" ollama serve
```
3. 安装模型：
```bash
ollama pull qwen2.5
```
4. 启动或重启Ollama服务
```bash
ollama serve
```
5. 注意事项
可使用自定义 API 接口地址来请求ollama服务：
`http://localhost:11434/v1/chat/completions` 
如果你是在局域网内其他主机运行的ollama服务，那么请将localhost替换为你的主机IP地址。

## 注意事项

1. 使用自定义API需要配置API密钥
2. 使用本地模型需要先安装并启动ollama，并确保服务在后台运行
3. 确保网络连接正常
4. 网页内容仅用于当前对话，刷新页面后对话的内容以及历史记录会丢失

## 隐私说明

- 本插件完全开源，不会收集任何个人信息
- 配置信息默认保存在本地浏览器中