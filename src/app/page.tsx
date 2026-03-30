'use client';

import Script from 'next/script';
import { useEffect, useRef, useState, useCallback } from 'react';

const availableModels = [
  { apiName: 'claude-sonnet-4', displayName: 'Claude Sonnet 4', shortName: 'Sonnet 4' },
  { apiName: 'claude-opus-4', displayName: 'Claude Opus 4', shortName: 'Opus 4' },
  { apiName: 'claude-3-7-sonnet', displayName: 'Claude 3.7 Sonnet', shortName: 'Sonnet 3.7' },
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  timestamp: Date;
  model: string;
}

export default function ClaudeInterface() {
  const [currentModel, setCurrentModel] = useState(availableModels[0].apiName);
  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [recentConversations, setRecentConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [puterReady, setPuterReady] = useState(false);
  const [authStatus, setAuthStatus] = useState<'idle' | 'authenticating' | 'success' | 'failed'>('idle');
  const [protocolNotice, setProtocolNotice] = useState('');

  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const welcomeInputRef = useRef<HTMLTextAreaElement>(null);
  const messageContentRef = useRef<HTMLDivElement | null>(null);
  const fullResponseRef = useRef<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (window.location.protocol === 'file:') {
        setProtocolNotice('✅ File mode: Authentication should work perfectly here!');
      } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        setProtocolNotice('⚠️ Server mode: If auth fails, browser profile issues are likely.');
      } else {
        setProtocolNotice('🌐 Web mode: Make sure popups are allowed for this domain.');
      }
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof window !== 'undefined' && typeof (window as any).puter !== 'undefined') {
        setPuterReady(true);
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const autoResize = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  }, []);

  const scrollToBottom = useCallback(() => {
    if (chatMessagesRef.current) {
      requestAnimationFrame(() => {
        if (chatMessagesRef.current) {
          chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
        }
      });
    }
  }, []);

  const updateModelDisplay = useCallback(() => {
    const model = availableModels.find(m => m.apiName === currentModel);
    const currentModelEl = document.getElementById('currentModel');
    const chatCurrentModelEl = document.getElementById('chatCurrentModel');
    if (model && currentModelEl) currentModelEl.textContent = model.displayName;
    if (model && chatCurrentModelEl) chatCurrentModelEl.textContent = model.shortName;
  }, [currentModel]);

  useEffect(() => {
    updateModelDisplay();
  }, [currentModel, updateModelDisplay]);

  const toggleModel = useCallback(() => {
    const currentIndex = availableModels.findIndex(m => m.apiName === currentModel);
    const nextIndex = (currentIndex + 1) % availableModels.length;
    setCurrentModel(availableModels[nextIndex].apiName);
  }, [currentModel]);

  const createNewConversation = useCallback((firstMessage: string) => {
    const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const title = firstMessage.length > 50 ? firstMessage.substring(0, 50) + '...' : firstMessage;
    const conversation: Conversation = {
      id,
      title,
      messages: [],
      timestamp: new Date(),
      model: currentModel,
    };
    setRecentConversations(prev => {
      const updated = [conversation, ...prev].slice(0, 10);
      return updated;
    });
    setCurrentConversationId(id);
  }, [currentModel]);

  const updateCurrentConversation = useCallback((messages: Message[]) => {
    if (!currentConversationId) return;
    setRecentConversations(prev => {
      const updated = prev.map(conv => {
        if (conv.id === currentConversationId) {
          return { ...conv, messages: [...messages], timestamp: new Date() };
        }
        return conv;
      });
      return updated;
    });
  }, [currentConversationId]);

  const startNewChat = useCallback(() => {
    setChatHistory([]);
    setCurrentConversationId(null);
    setCurrentModel(availableModels[0].apiName);
    if (welcomeInputRef.current) {
      welcomeInputRef.current.value = '';
      autoResize(welcomeInputRef.current);
      welcomeInputRef.current.focus();
    }
    if (chatInputRef.current) {
      chatInputRef.current.value = '';
      autoResize(chatInputRef.current);
    }
  }, [autoResize]);

  const loadConversation = useCallback((conversationId: string) => {
    const conversation = recentConversations.find(conv => conv.id === conversationId);
    if (!conversation) return;
    setCurrentConversationId(conversationId);
    setChatHistory([...conversation.messages]);
    setCurrentModel(conversation.model);
  }, [recentConversations]);

  const renderFormattedMessage = useCallback((content: string, container: HTMLDivElement) => {
    container.innerHTML = '';
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        const textPart = document.createElement('div');
        textPart.className = 'message-text-part';
        textPart.textContent = content.substring(lastIndex, match.index);
        container.appendChild(textPart);
      }

      const [fullMatch, language, code] = match;
      container.appendChild(createArtifactCanvas(code.trim(), language || 'text'));
      lastIndex = match.index + fullMatch.length;
    }

    if (lastIndex < content.length) {
      const textPart = document.createElement('div');
      textPart.className = 'message-text-part';
      textPart.textContent = content.substring(lastIndex);
      container.appendChild(textPart);
    }

    if (container.children.length === 0 && content) {
      const textPart = document.createElement('div');
      textPart.className = 'message-text-part';
      textPart.textContent = content;
      container.appendChild(textPart);
    }
  }, []);

  const addMessageToDOM = useCallback((content: string, role: 'user' | 'assistant', isError = false): HTMLDivElement => {
    const chatMessages = chatMessagesRef.current;
    if (!chatMessages) return document.createElement('div');

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    if (role === 'user') {
      avatar.textContent = 'U';
    } else {
      avatar.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
    }

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';

    if (role === 'assistant') {
      renderFormattedMessage(content, messageContent);
    } else {
      messageContent.textContent = content;
    }

    if (isError) messageContent.style.color = '#ff6b6b';

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(messageContent);
    chatMessages.appendChild(messageDiv);
    scrollToBottom();

    return messageContent;
  }, [renderFormattedMessage, scrollToBottom]);

  const createArtifactCanvas = (code: string, language: string): HTMLDivElement => {
    const canvas = document.createElement('div');
    canvas.className = 'artifact-canvas';

    const header = document.createElement('div');
    header.className = 'artifact-header';

    const title = document.createElement('div');
    title.className = 'artifact-title';
    title.textContent = language ? `${language} code` : 'Code Artifact';

    const actions = document.createElement('div');
    actions.className = 'artifact-actions';

    if (language.toLowerCase() === 'html') {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'artifact-btn view-btn';
      viewBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg> View';
      viewBtn.onclick = () => {
        const blob = new Blob([code], { type: 'text/html' });
        window.open(URL.createObjectURL(blob), '_blank');
      };
      actions.appendChild(viewBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'artifact-btn';
    const copyIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> Copy';
    copyBtn.innerHTML = copyIcon;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.innerHTML = copyIcon; }, 2000);
      });
    };

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'artifact-btn';
    downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Download';
    downloadBtn.onclick = () => {
      const extensionMap: Record<string, string> = { javascript: 'js', python: 'py', html: 'html', css: 'css', json: 'json', java: 'java', csharp: 'cs', cpp: 'cpp', ruby: 'rb', go: 'go', rust: 'rs', shell: 'sh', bash: 'sh' };
      const extension = extensionMap[language.toLowerCase()] || 'txt';
      const filename = `claude-code.${extension}`;
      const blob = new Blob([code], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      a.remove();
    };

    actions.appendChild(copyBtn);
    actions.appendChild(downloadBtn);
    header.appendChild(title);
    header.appendChild(actions);

    const codeArea = document.createElement('div');
    codeArea.className = 'artifact-code';
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    codeArea.appendChild(pre);

    canvas.appendChild(header);
    canvas.appendChild(codeArea);

    return canvas;
  };

  const sendMessage = useCallback(async (message: string) => {
    if (isStreaming) return;

    addMessageToDOM(message, 'user');
    const newHistory = [...chatHistory, { role: 'user' as const, content: message }];
    setChatHistory(newHistory);

    // Show typing indicator
    const typingEl = document.getElementById('typingIndicator');
    if (typingEl) typingEl.style.display = 'flex';

    try {
      setIsStreaming(true);
      const puter = (window as any).puter;
      if (typeof puter === 'undefined') {
        throw new Error('Puter.js is not available. Please wait for it to load or refresh the page.');
      }

      const response = await puter.ai.chat(newHistory, {
        model: currentModel,
        stream: true,
      });

      if (response && response.success === false) {
        throw new Error('Authentication required. Please click the authenticate button and allow the popup.');
      }

      // Hide typing, create assistant message
      if (typingEl) typingEl.style.display = 'none';

      const messageContent = addMessageToDOM('', 'assistant');
      fullResponseRef.current = '';

      for await (const part of response) {
        if (part?.text) {
          fullResponseRef.current += part.text;
          renderFormattedMessage(fullResponseRef.current, messageContent);
          scrollToBottom();
        }
      }

      renderFormattedMessage(fullResponseRef.current, messageContent);

      const finalHistory = [...newHistory, { role: 'assistant' as const, content: fullResponseRef.current }];
      setChatHistory(finalHistory);
      updateCurrentConversation(finalHistory);

    } catch (error: any) {
      if (typingEl) typingEl.style.display = 'none';
      addMessageToDOM('Sorry, I encountered an error: ' + (error.message || 'Unknown error.'), 'assistant', true);
      // Remove last user message from history on error
      setChatHistory(prev => prev.length > 0 && prev[prev.length - 1].role === 'user' ? prev.slice(0, -1) : prev);
    } finally {
      setIsStreaming(false);
      if (chatInputRef.current) chatInputRef.current.focus();
    }
  }, [isStreaming, chatHistory, currentModel, addMessageToDOM, renderFormattedMessage, scrollToBottom, updateCurrentConversation]);

  const handleWelcomeMessage = useCallback(() => {
    const message = welcomeInputRef.current?.value.trim();
    if (!message || isStreaming) return;
    createNewConversation(message);
    sendMessage(message);
  }, [isStreaming, createNewConversation, sendMessage]);

  const handleChatMessage = useCallback(() => {
    const message = chatInputRef.current?.value.trim();
    if (!message || isStreaming) return;
    if (chatInputRef.current) {
      chatInputRef.current.value = '';
      autoResize(chatInputRef.current);
    }
    sendMessage(message);
  }, [isStreaming, sendMessage, autoResize]);

  const handleManualAuth = useCallback(async () => {
    const puter = (window as any).puter;
    if (!puter) {
      setAuthStatus('failed');
      return;
    }
    try {
      setAuthStatus('authenticating');
      const authResponse = await puter.ai.chat('test', { model: 'claude-sonnet-4' });
      if (authResponse && (authResponse.message?.content || authResponse.success !== false)) {
        setAuthStatus('success');
        setTimeout(() => {
          const authBox = document.getElementById('authBox');
          if (authBox) authBox.style.display = 'none';
        }, 2000);
      } else {
        throw new Error('Authentication response indicates failure.');
      }
    } catch (error) {
      setAuthStatus('failed');
      alert(
        '⚠️ AUTHENTICATION FAILED!\n\nThis usually happens because of browser settings (extensions, cache, etc.).\n\nTry:\n1. Use Incognito/Private Mode\n2. Disable ad-blockers and privacy extensions\n3. Clear site data for puter.com\n4. Allow third-party cookies for puter.com'
      );
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>, type: 'welcome' | 'chat') => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (type === 'welcome') handleWelcomeMessage();
      else handleChatMessage();
    }
  }, [handleWelcomeMessage, handleChatMessage]);

  const handleActionBtnClick = useCallback((prompt: string) => {
    if (welcomeInputRef.current) {
      welcomeInputRef.current.value = prompt;
      welcomeInputRef.current.focus();
      autoResize(welcomeInputRef.current);
    }
  }, [autoResize]);

  const isInChat = currentConversationId !== null || chatHistory.length > 0;

  useEffect(() => {
    scrollToBottom();
  }, [isInChat, scrollToBottom]);

  // Re-render messages when loading a conversation
  useEffect(() => {
    const chatMessages = chatMessagesRef.current;
    if (!chatMessages) return;
    chatMessages.innerHTML = '';
    chatHistory.forEach(msg => {
      addMessageToDOM(msg.content, msg.role);
    });
  }, [chatHistory, addMessageToDOM]);

  return (
    <>
      <Script src="https://js.puter.com/v2/" strategy="beforeInteractive" />
      <div className="container">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-header">
            <div className="logo">
              <svg className="back-arrow" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
              Claude
            </div>
            <button className="new-chat-btn" id="newChatBtn" onClick={startNewChat}>
              <div className="plus-icon">+</div>
              New chat
            </button>
          </div>

          <div className="sidebar-nav">
            <div className="nav-item">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 6h-2.18c.11-.31.18-.65.18-1a2.996 2.996 0 0 0-5.5-1.65l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z" />
              </svg>
              Chats
            </div>
            <div className="nav-item">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
              </svg>
              Projects
            </div>
            <div className="nav-item">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              Artifacts
            </div>
          </div>

          <div className="sidebar-content">
            <div className="section-title">Recents</div>
            <div className="recent-items" id="recentItems">
              {recentConversations.length === 0 ? (
                <div className="empty-state">
                  <span style={{ color: '#666', fontSize: '13px', fontStyle: 'italic' }}>
                    No recent conversations
                  </span>
                </div>
              ) : (
                recentConversations.map(conv => (
                  <div
                    key={conv.id}
                    className="recent-item"
                    onClick={() => loadConversation(conv.id)}
                  >
                    {conv.title}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="sidebar-footer">
            <div className="user-info">
              <div className="user-avatar">U</div>
              <div className="user-details">
                <div className="user-name">User</div>
                <div className="user-plan">Free plan</div>
              </div>
              <svg className="chevron-down" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="main-content">
          <div className="content-area">
            {!isInChat ? (
              /* Welcome Screen */
              <div className="welcome-screen" id="welcomeScreen">
                <div className="greeting">
                  <svg className="sun-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z" />
                  </svg>
                  Good morning, User
                </div>

                <div className="search-container">
                  <textarea
                    className="search-input"
                    id="welcomeInput"
                    ref={welcomeInputRef}
                    placeholder="How can I help you today?"
                    rows={1}
                    disabled={isStreaming}
                    onInput={(e) => autoResize(e.target as HTMLTextAreaElement)}
                    onKeyDown={(e) => handleKeyDown(e, 'welcome')}
                    style={{ opacity: isStreaming ? 0.6 : 1 }}
                  />
                  <div className="search-actions">
                    <button className="search-btn" id="researchBtn">
                      Research
                    </button>
                    <button
                      className="send-btn"
                      id="sendBtn"
                      onClick={handleWelcomeMessage}
                      disabled={isStreaming}
                      style={{ opacity: isStreaming ? 0.6 : 1 }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div
                  id="authBox"
                  style={{
                    maxWidth: '600px',
                    marginBottom: '15px',
                    padding: '12px',
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    border: '1px solid #404040',
                  }}
                >
                  <div style={{ fontSize: '13px', color: '#b3b3b3', textAlign: 'center', marginBottom: '10px' }}>
                    💡 <strong>First time?</strong> A small popup will appear for authentication - please allow it
                    to enable free Claude access via Puter.js
                  </div>
                  <div
                    id="protocolNotice"
                    style={{ fontSize: '12px', color: '#808080', textAlign: 'center', marginBottom: '10px' }}
                  >
                    {protocolNotice}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <button
                      id="authButton"
                      onClick={handleManualAuth}
                      disabled={authStatus === 'authenticating'}
                      style={{
                        backgroundColor:
                          authStatus === 'success'
                            ? '#22c55e'
                            : authStatus === 'failed'
                            ? '#dc2626'
                            : '#ff6b35',
                        color: 'white',
                        border: 'none',
                        padding: '8px 16px',
                        borderRadius: '6px',
                        cursor: authStatus === 'authenticating' ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      {authStatus === 'idle'
                        ? '🔐 Authenticate with Puter'
                        : authStatus === 'authenticating'
                        ? '🔄 Authenticating...'
                        : authStatus === 'success'
                        ? '✅ Authenticated'
                        : '❌ Auth Failed - Retry'}
                    </button>
                  </div>
                </div>

                <div className="model-selector">
                  <button className="model-btn" id="modelSelector" onClick={toggleModel}>
                    <span id="currentModel">Claude Sonnet 4</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
                    </svg>
                  </button>
                </div>

                <div className="action-buttons">
                  {[
                    { prompt: 'Help me write', label: 'Write', icon: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' },
                    { prompt: 'Teach me about', label: 'Learn', icon: 'M12 3L1 9l4 2.18v6L12 21l7-3.82v-6L23 9l-11-6zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z' },
                    { prompt: 'Help me code', label: 'Code', icon: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z' },
                    { prompt: 'Help me with daily tasks', label: 'Life stuff', icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' },
                    { prompt: 'Help me connect my apps', label: 'Connect apps', icon: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H6.99C4.79 7 3 8.79 3 11s1.79 4 4 4H11v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1H13V17h4.01c2.2 0 4-1.79 4-4s-1.8-4-4.01-4z' },
                  ].map(item => (
                    <button
                      key={item.label}
                      className="action-btn"
                      data-prompt={item.prompt}
                      onClick={() => handleActionBtnClick(item.prompt)}
                    >
                      <svg className="action-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d={item.icon} />
                      </svg>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Chat Container */
              <div className="chat-container active" id="chatContainer">
                <div className="chat-messages" id="chatMessages" ref={chatMessagesRef} />

                <div className="typing-indicator" id="typingIndicator">
                  <div className="message-avatar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                    </svg>
                  </div>
                  <span>Claude is typing</span>
                  <div className="typing-dots">
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                  </div>
                </div>

                <div className="search-container">
                  <textarea
                    className="search-input"
                    id="chatInput"
                    ref={chatInputRef}
                    placeholder="Message Claude..."
                    rows={1}
                    disabled={isStreaming}
                    onInput={(e) => autoResize(e.target as HTMLTextAreaElement)}
                    onKeyDown={(e) => handleKeyDown(e, 'chat')}
                    style={{ opacity: isStreaming ? 0.6 : 1 }}
                  />
                  <div className="search-actions">
                    <button className="model-btn" id="chatModelSelector" onClick={toggleModel} style={{ padding: '6px 8px', fontSize: '12px' }}>
                      <span id="chatCurrentModel">Sonnet 4</span>
                    </button>
                    <button
                      className="send-btn"
                      id="chatSendBtn"
                      onClick={handleChatMessage}
                      disabled={isStreaming}
                      style={{ opacity: isStreaming ? 0.6 : 1 }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
          background-color: #1a1a1a;
          color: #e5e5e5;
          height: 100vh;
          overflow: hidden;
        }

        .container {
          display: flex;
          height: 100vh;
        }

        /* Sidebar */
        .sidebar {
          width: 280px;
          background-color: #262626;
          border-right: 1px solid #404040;
          display: flex;
          flex-direction: column;
        }

        .sidebar-header {
          padding: 16px;
          border-bottom: 1px solid #404040;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 18px;
          font-weight: 600;
          color: #fff;
          margin-bottom: 16px;
        }

        .back-arrow {
          width: 20px;
          height: 20px;
          opacity: 0.7;
        }

        .new-chat-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          background: none;
          border: none;
          color: #ff6b35;
          font-size: 14px;
          padding: 8px 0;
          cursor: pointer;
          transition: opacity 0.2s;
        }

        .new-chat-btn:hover {
          opacity: 0.8;
        }

        .plus-icon {
          width: 16px;
          height: 16px;
          background-color: #ff6b35;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: white;
        }

        .sidebar-nav {
          padding: 16px;
          border-bottom: 1px solid #404040;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 0;
          color: #b3b3b3;
          font-size: 14px;
          cursor: pointer;
          transition: color 0.2s;
        }

        .nav-item:hover {
          color: #fff;
        }

        .nav-icon {
          width: 16px;
          height: 16px;
          opacity: 0.7;
        }

        .sidebar-content {
          flex: 1;
          padding: 16px;
          overflow-y: auto;
        }

        .section-title {
          font-size: 12px;
          color: #808080;
          margin-bottom: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .recent-items {
          min-height: 20px;
        }

        .recent-item {
          padding: 8px 0;
          color: #b3b3b3;
          font-size: 13px;
          cursor: pointer;
          transition: color 0.2s;
          line-height: 1.4;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .recent-item:hover {
          color: #fff;
        }

        .empty-state {
          padding: 8px 0;
          text-align: center;
        }

        .sidebar-footer {
          padding: 16px;
          border-top: 1px solid #404040;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }

        .user-avatar {
          width: 24px;
          height: 24px;
          background-color: #ff6b35;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          color: white;
        }

        .user-details {
          flex: 1;
        }

        .user-name {
          font-size: 14px;
          color: #fff;
          font-weight: 500;
        }

        .user-plan {
          font-size: 12px;
          color: #808080;
        }

        .chevron-down {
          width: 16px;
          height: 16px;
          opacity: 0.5;
        }

        /* Main Content */
        .main-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          background-color: #1a1a1a;
        }

        .content-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
          width: 100%;
          position: relative;
        }

        .welcome-screen {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
          padding: 40px;
        }

        .chat-container {
          display: none;
          flex-direction: column;
          height: 100vh;
          max-height: 100vh;
          overflow: hidden;
        }

        .chat-container.active {
          display: flex;
        }

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 20px;
          margin-bottom: 20px;
          height: calc(100vh - 200px);
          min-height: 0;
          scrollbar-width: thin;
          scrollbar-color: #404040 #262626;
          scroll-behavior: smooth;
        }

        .chat-messages::-webkit-scrollbar {
          width: 8px;
        }

        .chat-messages::-webkit-scrollbar-track {
          background: #262626;
          border-radius: 4px;
        }

        .chat-messages::-webkit-scrollbar-thumb {
          background: #404040;
          border-radius: 4px;
        }

        .chat-messages::-webkit-scrollbar-thumb:hover {
          background: #555;
        }

        .message {
          margin-bottom: 24px;
          display: flex;
          gap: 12px;
        }

        .message.user {
          flex-direction: row-reverse;
        }

        .message-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .message.user .message-avatar {
          background-color: #ff6b35;
          color: white;
        }

        .message.assistant .message-avatar {
          background-color: #4a90e2;
          color: white;
        }

        .message-content {
          max-width: 70%;
          background-color: #262626;
          border-radius: 12px;
          padding: 16px;
          color: #e5e5e5;
          line-height: 1.5;
          word-wrap: break-word;
          overflow-wrap: break-word;
          white-space: pre-wrap;
        }

        .message.assistant .message-content {
          padding: 0;
        }

        .message-text-part {
          padding: 16px;
          white-space: pre-wrap;
        }

        .message.user .message-content {
          background-color: #ff6b35;
          color: white;
          padding: 16px;
        }

        .typing-indicator {
          display: none;
          align-items: center;
          gap: 8px;
          color: #808080;
          font-style: italic;
          padding: 16px;
        }

        .typing-dots {
          display: flex;
          gap: 4px;
        }

        .typing-dot {
          width: 6px;
          height: 6px;
          background-color: #808080;
          border-radius: 50%;
          animation: typing 1.4s infinite ease-in-out;
        }

        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }

        @keyframes typing {
          0%, 80%, 100% {
            transform: scale(1);
            opacity: 0.5;
          }
          40% {
            transform: scale(1.2);
            opacity: 1;
          }
        }

        .greeting {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 40px;
          font-size: 32px;
          font-weight: 400;
          color: #fff;
        }

        .sun-icon {
          width: 32px;
          height: 32px;
          color: #ff6b35;
        }

        .search-container {
          width: 100%;
          max-width: 600px;
          position: relative;
          margin-bottom: 20px;
        }

        .chat-container .search-container {
          position: sticky;
          bottom: 0;
          background-color: #1a1a1a;
          padding: 20px 0;
          margin: 0;
          max-width: none;
        }

        .search-input {
          width: 100%;
          padding: 16px 120px 16px 16px;
          background-color: #262626;
          border: 1px solid #404040;
          border-radius: 12px;
          color: #fff;
          font-size: 16px;
          outline: none;
          transition: border-color 0.2s;
          resize: none;
          min-height: 50px;
          max-height: 150px;
          font-family: inherit;
        }

        .search-input:focus {
          border-color: #ff6b35;
        }

        .search-input::placeholder {
          color: #808080;
        }

        .search-actions {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          gap: 4px;
        }

        .search-btn {
          padding: 8px;
          background: none;
          border: none;
          color: #808080;
          cursor: pointer;
          border-radius: 6px;
          transition: background-color 0.2s;
        }

        .search-btn:hover {
          background-color: #404040;
        }

        .send-btn {
          padding: 8px;
          background-color: #ff6b35;
          border: none;
          color: white;
          cursor: pointer;
          border-radius: 6px;
          transition: background-color 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .send-btn:hover {
          background-color: #e55a2b;
        }

        .send-btn:disabled {
          background-color: #404040;
          cursor: not-allowed;
        }

        .model-selector {
          align-self: flex-end;
          margin-bottom: 20px;
          margin-right: 60px;
        }

        .model-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          background: none;
          border: none;
          color: #b3b3b3;
          font-size: 14px;
          cursor: pointer;
          padding: 8px 12px;
          border-radius: 6px;
          transition: background-color 0.2s;
        }

        .model-btn:hover {
          background-color: #262626;
        }

        .action-buttons {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .action-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px;
          background-color: #262626;
          border: 1px solid #404040;
          border-radius: 8px;
          color: #e5e5e5;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
          text-decoration: none;
        }

        .action-btn:hover {
          background-color: #333;
          border-color: #555;
          transform: translateY(-1px);
        }

        .action-icon {
          width: 16px;
          height: 16px;
          opacity: 0.8;
        }

        /* Artifact Canvas Styles */
        .artifact-canvas {
          background-color: #0d0d0d;
          border: 1px solid #404040;
          border-radius: 8px;
          margin: 16px;
          overflow: hidden;
        }

        .artifact-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background-color: #2a2a2a;
          padding: 8px 12px;
          border-bottom: 1px solid #404040;
        }

        .artifact-title {
          font-size: 13px;
          font-weight: 500;
          color: #b3b3b3;
        }

        .artifact-actions {
          display: flex;
          gap: 8px;
        }

        .artifact-btn {
          background: none;
          border: 1px solid #555;
          color: #b3b3b3;
          padding: 4px 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.2s;
        }

        .artifact-btn:hover {
          background-color: #404040;
          color: #fff;
        }

        .artifact-btn.view-btn {
          border-color: #4a90e2;
          color: #4a90e2;
        }

        .artifact-btn.view-btn:hover {
          background-color: #4a90e2;
          color: #fff;
        }

        .artifact-btn svg {
          width: 14px;
          height: 14px;
        }

        .artifact-code {
          padding: 12px;
          max-height: 400px;
          overflow: auto;
          scrollbar-width: thin;
          scrollbar-color: #404040 #1a1a1a;
        }

        .artifact-code pre {
          margin: 0;
        }

        .artifact-code code {
          font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
          font-size: 13px;
          color: #e5e5e5;
          white-space: pre;
        }

        @media (max-width: 768px) {
          .sidebar {
            width: 240px;
          }

          .greeting {
            font-size: 24px;
          }

          .action-buttons {
            flex-direction: column;
            width: 100%;
          }

          .action-btn {
            justify-content: center;
          }
        }
      `}</style>
    </>
  );
}
