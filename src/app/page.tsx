'use client';

import Script from 'next/script';
import { useEffect, useRef, useState, useCallback } from 'react';

const availableModels = [
  { apiName: 'claude-sonnet-4', displayName: 'Claude Sonnet 4', shortName: 'Sonnet 4' },
  { apiName: 'claude-opus-4', displayName: 'Claude Opus 4', shortName: 'Opus 4' },
  { apiName: 'claude-3-7-sonnet', displayName: 'Claude 3.7 Sonnet', shortName: 'Sonnet 3.7' },
];

type FileStatus = 'loading' | 'ready' | 'error';

interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  base64: string;
  isImage: boolean;
  status: FileStatus;
  errorMsg?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  attachments?: AttachedFile[];
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  timestamp: Date;
  model: string;
}

type SidebarTab = 'chats' | 'projects' | 'artifacts';

export default function ClaudeInterface() {
  const [currentModel, setCurrentModel] = useState(availableModels[0].apiName);
  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [recentConversations, setRecentConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<'idle' | 'authenticating' | 'success' | 'failed'>('idle');
  const [protocolNotice, setProtocolNotice] = useState('');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chats');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [uploadToast, setUploadToast] = useState<{message: string; type: 'success' | 'error' | 'info'} | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [userName, setUserName] = useState('User');
  const [userPlan, setUserPlan] = useState('Free plan');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const welcomeInputRef = useRef<HTMLTextAreaElement>(null);
  const fullResponseRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  // Ref to always have the latest conversation ID (avoids stale closure in async functions)
  const currentConversationIdRef = useRef<string | null>(null);

  // Load saved data
  useEffect(() => {
    try {
      const savedName = localStorage.getItem('claude-user-name');
      const savedPlan = localStorage.getItem('claude-user-plan');
      if (savedName) setUserName(savedName);
      if (savedPlan) setUserPlan(savedPlan);
    } catch {}
  }, []);

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

  // Close user menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
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

  useEffect(() => { updateModelDisplay(); }, [currentModel, updateModelDisplay]);

  const toggleModel = useCallback(() => {
    const currentIndex = availableModels.findIndex(m => m.apiName === currentModel);
    const nextIndex = (currentIndex + 1) % availableModels.length;
    setCurrentModel(availableModels[nextIndex].apiName);
  }, [currentModel]);

  const createNewConversation = useCallback((firstMessage: string, files: AttachedFile[] = []) => {
    const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    let title = firstMessage.length > 50 ? firstMessage.substring(0, 50) + '...' : firstMessage;
    if (!firstMessage && files.length > 0) {
      title = files.map(f => f.name).join(', ');
    }
    const conversation: Conversation = { id, title, messages: [], timestamp: new Date(), model: currentModel };
    setRecentConversations(prev => [conversation, ...prev].slice(0, 20));
    setCurrentConversationId(id);
    currentConversationIdRef.current = id;
  }, [currentModel]);

  const updateCurrentConversation = useCallback((messages: Message[]) => {
    const convId = currentConversationIdRef.current;
    if (!convId) return;
    setRecentConversations(prev => prev.map(conv =>
      conv.id === convId ? { ...conv, messages: [...messages], timestamp: new Date() } : conv
    ));
  }, []);

  const deleteConversation = useCallback((convId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRecentConversations(prev => prev.filter(c => c.id !== convId));
    if (currentConversationId === convId) {
      startNewChat();
    }
  }, [currentConversationId]);

  const startNewChat = useCallback(() => {
    setChatHistory([]);
    setCurrentConversationId(null);
    currentConversationIdRef.current = null;
    setCurrentModel(availableModels[0].apiName);
    setAttachedFiles([]);
    if (welcomeInputRef.current) { welcomeInputRef.current.value = ''; autoResize(welcomeInputRef.current); welcomeInputRef.current.focus(); }
    if (chatInputRef.current) { chatInputRef.current.value = ''; autoResize(chatInputRef.current); }
  }, [autoResize]);

  const loadConversation = useCallback((conversationId: string) => {
    const conversation = recentConversations.find(conv => conv.id === conversationId);
    if (!conversation) return;
    setCurrentConversationId(conversationId);
    currentConversationIdRef.current = conversationId;
    setChatHistory([...conversation.messages]);
    setCurrentModel(conversation.model);
    setAttachedFiles([]);
    setSidebarTab('chats');
  }, [recentConversations]);

  // Extract artifacts from all conversations
  const getAllArtifacts = useCallback(() => {
    const artifacts: { code: string; language: string; convTitle: string; convId: string }[] = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    recentConversations.forEach(conv => {
      conv.messages.forEach(msg => {
        if (msg.role === 'assistant') {
          let match;
          while ((match = codeBlockRegex.exec(msg.content)) !== null) {
            const lang = match[1] || 'text';
            if (lang !== 'text' && match[2].trim().length > 10) {
              artifacts.push({ code: match[2].trim(), language: lang, convTitle: conv.title, convId: conv.id });
            }
          }
        }
      });
    });
    return artifacts;
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

  const addMessageToDOM = useCallback((content: string, role: 'user' | 'assistant', isError = false, attachments?: AttachedFile[]): HTMLDivElement => {
    const chatMessages = chatMessagesRef.current;
    if (!chatMessages) return document.createElement('div');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    if (role === 'user') avatar.textContent = 'U';
    else avatar.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    if (role === 'assistant') renderFormattedMessage(content, messageContent);
    else {
      if (attachments && attachments.length > 0) {
        const attachContainer = document.createElement('div');
        attachContainer.className = 'attachments-preview-in-message';
        attachments.forEach(att => {
          const attEl = document.createElement('div');
          attEl.className = 'attachment-chip-in-message';
          if (att.isImage) {
            const img = document.createElement('img');
            img.src = att.base64;
            img.className = 'attachment-thumb-in-message';
            img.alt = att.name;
            attEl.appendChild(img);
          }
          const info = document.createElement('div');
          info.className = 'attachment-info-in-message';
          const nameSpan = document.createElement('span');
          nameSpan.className = 'attachment-name-in-message';
          nameSpan.textContent = att.name;
          const sizeSpan = document.createElement('span');
          sizeSpan.className = 'attachment-size-in-message';
          sizeSpan.textContent = formatFileSize(att.size);
          info.appendChild(nameSpan);
          info.appendChild(sizeSpan);
          attEl.appendChild(info);
          attachContainer.appendChild(attEl);
        });
        messageContent.appendChild(attachContainer);
        const textPart = document.createElement('div');
        textPart.className = 'message-text-part';
        textPart.textContent = content;
        messageContent.appendChild(textPart);
      } else {
        messageContent.textContent = content;
      }
    }
    if (isError) messageContent.style.color = '#ff6b6b';
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(messageContent);
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
    return messageContent;
  }, [renderFormattedMessage, scrollToBottom]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };

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
      viewBtn.onclick = () => { const blob = new Blob([code], { type: 'text/html' }); window.open(URL.createObjectURL(blob), '_blank'); };
      actions.appendChild(viewBtn);
    }
    const copyBtn = document.createElement('button');
    copyBtn.className = 'artifact-btn';
    const copyIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> Copy';
    copyBtn.innerHTML = copyIcon;
    copyBtn.onclick = () => { navigator.clipboard.writeText(code).then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.innerHTML = copyIcon; }, 2000); }); };
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'artifact-btn';
    downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Download';
    downloadBtn.onclick = () => {
      const extMap: Record<string, string> = { javascript: 'js', python: 'py', html: 'html', css: 'css', json: 'json', java: 'java', csharp: 'cs', cpp: 'cpp', ruby: 'rb', go: 'go', rust: 'rs', shell: 'sh', bash: 'sh', typescript: 'ts', jsx: 'jsx', tsx: 'tsx', sql: 'sql', xml: 'xml', yaml: 'yml', markdown: 'md' };
      const ext = extMap[language.toLowerCase()] || 'txt';
      const blob = new Blob([code], { type: 'text/plain' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `claude-code.${ext}`; a.click(); a.remove();
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

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setUploadToast({ message, type });
    toastTimerRef.current = setTimeout(() => setUploadToast(null), 3500);
  }, []);

  // File handling
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const totalFiles = files.length;
    let completed = 0;
    let failed = 0;

    Array.from(files).forEach((file, index) => {
      const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

      // Immediately show file as "loading"
      setAttachedFiles(prev => [...prev, {
        id: fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        base64: '',
        isImage: file.type.startsWith('image/'),
        status: 'loading',
      }]);

      const reader = new FileReader();
      const maxFileSize = 10 * 1024 * 1024; // 10MB limit

      if (file.size > maxFileSize) {
        failed++;
        setAttachedFiles(prev => prev.map(f =>
          f.id === fileId ? { ...f, status: 'error', errorMsg: 'File too large (max 10MB)' } : f
        ));
        completed++;
        if (completed === totalFiles) {
          if (failed === 0) showToast(`${totalFiles} file${totalFiles > 1 ? 's' : ''} attached successfully!`, 'success');
          else if (failed === totalFiles) showToast(`Failed to attach all files.`, 'error');
          else showToast(`${completed - failed} of ${totalFiles} files attached. ${failed} failed.`, 'info');
        }
        return;
      }

      reader.onload = () => {
        const base64 = reader.result as string;
        setAttachedFiles(prev => prev.map(f =>
          f.id === fileId ? { ...f, base64, status: 'ready' } : f
        ));
        completed++;
        if (completed === totalFiles) {
          if (failed === 0) showToast(`${totalFiles} file${totalFiles > 1 ? 's' : ''} attached successfully!`, 'success');
          else if (failed === totalFiles) showToast(`Failed to attach all files.`, 'error');
          else showToast(`${completed - failed} of ${totalFiles} files attached. ${failed} failed.`, 'info');
        }
      };
      reader.onerror = () => {
        failed++;
        setAttachedFiles(prev => prev.map(f =>
          f.id === fileId ? { ...f, status: 'error', errorMsg: 'Failed to read file' } : f
        ));
        completed++;
        if (completed === totalFiles) {
          if (failed === totalFiles) showToast(`Failed to attach all files.`, 'error');
          else showToast(`${completed - failed} of ${totalFiles} files attached. ${failed} failed.`, 'info');
        }
      };
      reader.readAsDataURL(file);
    });

    if (e.target) e.target.value = '';
  }, [showToast]);

  const removeAttachment = useCallback((fileId: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
  }, []);

  const sendMessage = useCallback(async (message: string, files: AttachedFile[] = []) => {
    if (isStreaming) return;
    const readyFiles = files.filter(f => f.status === 'ready');
    addMessageToDOM(message, 'user', false, readyFiles.length > 0 ? readyFiles : undefined);
    const newHistory = [...chatHistory, { role: 'user' as const, content: message, attachments: readyFiles.length > 0 ? readyFiles : undefined }];
    setChatHistory(newHistory);
    const typingEl = document.getElementById('typingIndicator');
    if (typingEl) typingEl.style.display = 'flex';
    try {
      setIsStreaming(true);
      const puter = (window as any).puter;
      if (typeof puter === 'undefined') throw new Error('Puter.js is not available. Please wait for it to load or refresh the page.');
      // Build messages with image support
      const apiMessages = newHistory.map(msg => {
        if (msg.attachments && msg.attachments.length > 0) {
          const imageAttachments = msg.attachments.filter(a => a.isImage);
          if (imageAttachments.length > 0) {
            const content: any[] = [{ type: 'text', text: msg.content || 'Please analyze these images.' }];
            imageAttachments.forEach(att => {
              content.push({ type: 'image', source: { type: 'base64', media_type: att.type, data: att.base64.split(',')[1] } });
            });
            return { role: msg.role, content };
          }
          // Non-image files: include info in text
          const fileInfo = msg.attachments.map(a => `[File: ${a.name} (${formatFileSize(a.size)})]`).join('\n');
          return { role: msg.role, content: msg.content ? `${msg.content}\n\nAttached files:\n${fileInfo}` : `Please analyze these files:\n${fileInfo}` };
        }
        return { role: msg.role, content: msg.content };
      });
      const response = await puter.ai.chat(apiMessages, { model: currentModel, stream: true });
      if (response && response.success === false) throw new Error('Authentication required. Please click the authenticate button and allow the popup.');
      if (typingEl) typingEl.style.display = 'none';
      const messageContent = addMessageToDOM('', 'assistant');
      fullResponseRef.current = '';
      for await (const part of response) {
        if (part?.text) { fullResponseRef.current += part.text; renderFormattedMessage(fullResponseRef.current, messageContent); scrollToBottom(); }
      }
      renderFormattedMessage(fullResponseRef.current, messageContent);
      const finalHistory = [...newHistory, { role: 'assistant' as const, content: fullResponseRef.current }];
      setChatHistory(finalHistory);
      updateCurrentConversation(finalHistory);
    } catch (error: any) {
      if (typingEl) typingEl.style.display = 'none';
      addMessageToDOM('Sorry, I encountered an error: ' + (error.message || 'Unknown error.'), 'assistant', true);
      setChatHistory(prev => prev.length > 0 && prev[prev.length - 1].role === 'user' ? prev.slice(0, -1) : prev);
    } finally {
      setIsStreaming(false);
      setAttachedFiles([]);
      if (chatInputRef.current) chatInputRef.current.focus();
    }
  }, [isStreaming, chatHistory, currentModel, addMessageToDOM, renderFormattedMessage, scrollToBottom, updateCurrentConversation]);

  const handleWelcomeMessage = useCallback(() => {
    const message = welcomeInputRef.current?.value.trim() || (attachedFiles.length > 0 ? '' : '');
    if ((!message && attachedFiles.length === 0) || isStreaming) return;
    createNewConversation(message, attachedFiles);
    if (welcomeInputRef.current) { welcomeInputRef.current.value = ''; autoResize(welcomeInputRef.current); }
    sendMessage(message, attachedFiles);
    setAttachedFiles([]);
  }, [isStreaming, attachedFiles, createNewConversation, sendMessage, autoResize]);

  const handleChatMessage = useCallback(() => {
    const message = chatInputRef.current?.value.trim() || (attachedFiles.length > 0 ? '' : '');
    if ((!message && attachedFiles.length === 0) || isStreaming) return;
    if (chatInputRef.current) { chatInputRef.current.value = ''; autoResize(chatInputRef.current); }
    sendMessage(message, attachedFiles);
  }, [isStreaming, attachedFiles, sendMessage, autoResize]);

  const handleManualAuth = useCallback(async () => {
    const puter = (window as any).puter;
    if (!puter) { setAuthStatus('failed'); return; }
    try {
      setAuthStatus('authenticating');
      const authResponse = await puter.ai.chat('test', { model: 'claude-sonnet-4' });
      if (authResponse && (authResponse.message?.content || authResponse.success !== false)) {
        setAuthStatus('success');
        setTimeout(() => { const authBox = document.getElementById('authBox'); if (authBox) authBox.style.display = 'none'; }, 2000);
      } else throw new Error('Authentication failed.');
    } catch (error) {
      setAuthStatus('failed');
      alert('⚠️ AUTHENTICATION FAILED!\n\nTry:\n1. Use Incognito/Private Mode\n2. Disable ad-blockers\n3. Clear site data for puter.com\n4. Allow third-party cookies');
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>, type: 'welcome' | 'chat') => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (type === 'welcome') handleWelcomeMessage(); else handleChatMessage(); }
  }, [handleWelcomeMessage, handleChatMessage]);

  const handleActionBtnClick = useCallback((prompt: string) => {
    if (welcomeInputRef.current) { welcomeInputRef.current.value = prompt; welcomeInputRef.current.focus(); autoResize(welcomeInputRef.current); }
  }, [autoResize]);

  const isInChat = currentConversationId !== null || chatHistory.length > 0;
  const allArtifacts = getAllArtifacts();

  useEffect(() => { scrollToBottom(); }, [isInChat, scrollToBottom]);

  useEffect(() => {
    const chatMessages = chatMessagesRef.current;
    if (!chatMessages) return;
    chatMessages.innerHTML = '';
    chatHistory.forEach(msg => {
      addMessageToDOM(msg.content, msg.role, false, msg.attachments);
    });
  }, [chatHistory, addMessageToDOM]);

  return (
    <>
      <Script src="https://js.puter.com/v2/" strategy="beforeInteractive" />
      <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} style={{ display: 'none' }}
        accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json,.xml,.html,.css,.js,.ts,.py,.java,.c,.cpp,.go,.rs,.rb,.php,.sql,.md,.yaml,.yml,.zip,.rar,.7z,.mp3,.mp4,.wav,.xlsx,.xls,.ppt,.pptx" />
      
      {/* Upload Toast Notification */}
      {uploadToast && (
        <div className={`upload-toast upload-toast-${uploadToast.type}`}>
          <div className="upload-toast-icon">
            {uploadToast.type === 'success' && <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>}
            {uploadToast.type === 'error' && <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>}
            {uploadToast.type === 'info' && <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>}
          </div>
          <span>{uploadToast.message}</span>
          <button className="upload-toast-close" onClick={() => setUploadToast(null)}>✕</button>
        </div>
      )}

      <div className="container">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-header">
            <div className="logo">
              <img src="/favicon.svg" alt="Claude" className="claude-logo" />
              Claude
            </div>
            <button className="new-chat-btn" onClick={startNewChat}>
              <div className="plus-icon">+</div>
              New chat
            </button>
          </div>

          <div className="sidebar-nav">
            {([
              { tab: 'chats' as SidebarTab, label: 'Chats', icon: 'M20 6h-2.18c.11-.31.18-.65.18-1a2.996 2.996 0 0 0-5.5-1.65l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z' },
              { tab: 'projects' as SidebarTab, label: 'Projects', icon: 'M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z' },
              { tab: 'artifacts' as SidebarTab, label: 'Artifacts', icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' },
            ]).map(nav => (
              <div key={nav.tab} className={`nav-item ${sidebarTab === nav.tab ? 'nav-item-active' : ''}`} onClick={() => setSidebarTab(nav.tab)}>
                <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d={nav.icon} /></svg>
                {nav.label}
                {nav.tab === 'artifacts' && allArtifacts.length > 0 && <span className="nav-badge">{allArtifacts.length}</span>}
              </div>
            ))}
          </div>

          <div className="sidebar-content">
            {sidebarTab === 'chats' && (
              <>
                <div className="section-title">Recent Chats</div>
                <div className="recent-items">
                  {recentConversations.length === 0 ? (
                    <div className="empty-state"><span>No recent conversations</span></div>
                  ) : (
                    recentConversations.map(conv => (
                      <div key={conv.id} className="recent-item-wrapper" onClick={() => loadConversation(conv.id)}>
                        <div className="recent-item">{conv.title}</div>
                        {showDeleteConfirm === conv.id ? (
                          <div className="delete-confirm">
                            <span>Delete?</span>
                            <button onClick={(e) => { deleteConversation(conv.id, e); setShowDeleteConfirm(null); }} className="delete-yes">Yes</button>
                            <button onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(null); }} className="delete-no">No</button>
                          </div>
                        ) : (
                          <button className="delete-btn" onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(conv.id); }} title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
            {sidebarTab === 'projects' && (
              <>
                <div className="section-title">Projects</div>
                <div className="projects-panel">
                  <div className="projects-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.3, marginBottom: '12px' }}>
                      <path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                    </svg>
                    <p style={{ color: '#808080', fontSize: '13px', textAlign: 'center', lineHeight: '1.5' }}>
                      Organize your conversations<br />into projects
                    </p>
                    <div className="projects-features">
                      <div className="project-feature-item">
                        <span style={{ color: '#ff6b35' }}>📁</span>
                        <span>Group related chats</span>
                      </div>
                      <div className="project-feature-item">
                        <span style={{ color: '#ff6b35' }}>🏷️</span>
                        <span>Label by topic</span>
                      </div>
                      <div className="project-feature-item">
                        <span style={{ color: '#ff6b35' }}>🔍</span>
                        <span>Quick search</span>
                      </div>
                    </div>
                    <p style={{ color: '#555', fontSize: '12px', marginTop: '12px' }}>
                      Coming soon in a future update!
                    </p>
                  </div>
                </div>
              </>
            )}
            {sidebarTab === 'artifacts' && (
              <>
                <div className="section-title">Saved Artifacts</div>
                <div className="recent-items">
                  {allArtifacts.length === 0 ? (
                    <div className="empty-state"><span>No artifacts yet.<br/>Generate code in a chat to see artifacts here.</span></div>
                  ) : (
                    allArtifacts.map((art, idx) => (
                      <div key={idx} className="artifact-sidebar-item" onClick={() => { loadConversation(art.convId); }}>
                        <div className="artifact-sidebar-lang">{art.language}</div>
                        <div className="artifact-sidebar-info">
                          <div className="artifact-sidebar-title">{art.convTitle}</div>
                          <div className="artifact-sidebar-meta">{art.code.split('\n').length} lines</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <div className="sidebar-footer" ref={userMenuRef}>
            <div className="user-info" onClick={() => setShowUserMenu(!showUserMenu)}>
              <div className="user-avatar">{userName.charAt(0).toUpperCase()}</div>
              <div className="user-details">
                <div className="user-name">{userName}</div>
                <div className="user-plan">{userPlan}</div>
              </div>
              <svg className={`chevron-down ${showUserMenu ? 'chevron-up' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
            </div>
            {showUserMenu && (
              <div className="user-menu">
                <div className="user-menu-header">
                  <div className="user-menu-avatar">{userName.charAt(0).toUpperCase()}</div>
                  <div>
                    <div className="user-menu-name" contentEditable suppressContentEditableWarning onBlur={(e) => {
                      const newName = e.currentTarget.textContent?.trim() || 'User';
                      setUserName(newName);
                      localStorage.setItem('claude-user-name', newName);
                    }}>{userName}</div>
                    <div className="user-menu-plan">{userPlan} via Puter.js</div>
                  </div>
                </div>
                <div className="user-menu-divider" />
                <div className="user-menu-item" onClick={() => { navigator.clipboard.writeText(window.location.href); setShowUserMenu(false); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                  Share link
                </div>
                <div className="user-menu-item" onClick={() => {
                  if (confirm('Clear all conversation history?')) { setRecentConversations([]); localStorage.removeItem('claude-conversations'); startNewChat(); }
                  setShowUserMenu(false);
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                  Clear history
                </div>
                <div className="user-menu-item" onClick={() => { startNewChat(); setShowUserMenu(false); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                  New conversation
                </div>
                <div className="user-menu-divider" />
                <div className="user-menu-item user-menu-footer" onClick={() => setShowUserMenu(false)}>
                  Claude Interface v1.0 &middot; Powered by Puter.js
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="main-content">
          {/* Welcome screen - shown when no conversation is active */}
          {!isInChat && (
            <div className="welcome-screen" id="welcomeScreen">
              <div className="welcome-inner">
                <div className="greeting">
                  <svg className="sun-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/>
                  </svg>
                  Good morning, {userName}
                </div>

                <div className="search-container">
                  {attachedFiles.length > 0 && (
                    <div className="attachments-bar">
                      {attachedFiles.map((file) => (
                        <div key={file.id} className={`attachment-chip attachment-chip-${file.status}`}>
                          {file.status === 'loading' && (
                            <div className="attachment-spinner" />
                          )}
                          {file.status === 'ready' && !file.isImage && (
                            <div className="attachment-file-icon">📄</div>
                          )}
                          {file.status === 'ready' && file.isImage && (
                            <img src={file.base64} alt={file.name} className="attachment-thumb" />
                          )}
                          {file.status === 'error' && (
                            <div className="attachment-error-icon">⚠️</div>
                          )}
                          <div className="attachment-info">
                            <span className="attachment-name">{file.name}</span>
                            <span className={`attachment-size ${file.status === 'loading' ? 'attachment-size-loading' : ''}`}>
                              {file.status === 'loading' ? 'Uploading...' : file.status === 'error' ? file.errorMsg : formatFileSize(file.size)}
                            </span>
                          </div>
                          <button className="attachment-remove" onClick={() => removeAttachment(file.id)}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea className="search-input" ref={welcomeInputRef} placeholder="How can I help you today?" rows={1}
                    disabled={isStreaming} onInput={(e) => autoResize(e.target as HTMLTextAreaElement)}
                    onKeyDown={(e) => handleKeyDown(e, 'welcome')} style={{ opacity: isStreaming ? 0.6 : 1 }} />
                  <div className="search-actions">
                    <button className="attach-btn" title="Attach files" onClick={() => fileInputRef.current?.click()}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                      </svg>
                    </button>
                    <button className="search-btn">Research</button>
                    <button className="send-btn" onClick={handleWelcomeMessage} disabled={isStreaming} style={{ opacity: isStreaming ? 0.6 : 1 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </button>
                  </div>
                </div>

                <div id="authBox" className="auth-box">
                  <div style={{ fontSize: '13px', color: '#b3b3b3', textAlign: 'center', marginBottom: '10px' }}>
                    💡 <strong>First time?</strong> A popup will appear for authentication - please allow it
                  </div>
                  <div id="protocolNotice" style={{ fontSize: '12px', color: '#808080', textAlign: 'center', marginBottom: '10px' }}>{protocolNotice}</div>
                  <div style={{ textAlign: 'center' }}>
                    <button id="authButton" onClick={handleManualAuth} disabled={authStatus === 'authenticating'}
                      style={{ backgroundColor: authStatus === 'success' ? '#22c55e' : authStatus === 'failed' ? '#dc2626' : '#ff6b35', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: authStatus === 'authenticating' ? 'not-allowed' : 'pointer', fontSize: '12px' }}>
                      {authStatus === 'idle' ? '🔐 Authenticate with Puter' : authStatus === 'authenticating' ? '🔄 Authenticating...' : authStatus === 'success' ? '✅ Authenticated' : '❌ Auth Failed - Retry'}
                    </button>
                  </div>
                </div>

                <div className="model-selector">
                  <button className="model-btn" onClick={toggleModel}>
                    <span id="currentModel">Claude Sonnet 4</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
                  </button>
                </div>

                <div className="action-buttons">
                  {[
                    { prompt: 'Help me write', label: 'Write', icon: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' },
                    { prompt: 'Teach me about', label: 'Learn', icon: 'M12 3L1 9l4 2.18v6L12 21l7-3.82v-6L23 9l-11-6zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z' },
                    { prompt: 'Help me code', label: 'Code', icon: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z' },
                    { prompt: 'Help me with daily tasks', label: 'Life stuff', icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' },
                  ].map(item => (
                    <button key={item.label} className="action-btn" onClick={() => handleActionBtnClick(item.prompt)}>
                      <svg className="action-icon" viewBox="0 0 24 24" fill="currentColor"><path d={item.icon}/></svg>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Chat view - shown when conversation is active */}
          {isInChat && (
            <div className="chat-view" id="chatContainer">
              <div className="chat-messages" id="chatMessages" ref={chatMessagesRef} />
              <div className="typing-indicator" id="typingIndicator">
                <div className="message-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></div>
                <span>Claude is typing</span>
                <div className="typing-dots"><div className="typing-dot"></div><div className="typing-dot"></div><div className="typing-dot"></div></div>
              </div>
              <div className="chat-input-area">
                <div className="chat-input-inner">
                  {attachedFiles.length > 0 && (
                    <div className="attachments-bar">
                      {attachedFiles.map((file) => (
                        <div key={file.id} className={`attachment-chip attachment-chip-${file.status}`}>
                          {file.status === 'loading' && (
                            <div className="attachment-spinner" />
                          )}
                          {file.status === 'ready' && !file.isImage && (
                            <div className="attachment-file-icon">📄</div>
                          )}
                          {file.status === 'ready' && file.isImage && (
                            <img src={file.base64} alt={file.name} className="attachment-thumb" />
                          )}
                          {file.status === 'error' && (
                            <div className="attachment-error-icon">⚠️</div>
                          )}
                          <div className="attachment-info">
                            <span className="attachment-name">{file.name}</span>
                            <span className={`attachment-size ${file.status === 'loading' ? 'attachment-size-loading' : ''}`}>
                              {file.status === 'loading' ? 'Uploading...' : file.status === 'error' ? file.errorMsg : formatFileSize(file.size)}
                            </span>
                          </div>
                          <button className="attachment-remove" onClick={() => removeAttachment(file.id)}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="chat-input-row">
                    <textarea className="chat-textarea" ref={chatInputRef} placeholder="Message Claude..." rows={1}
                      disabled={isStreaming} onInput={(e) => autoResize(e.target as HTMLTextAreaElement)}
                      onKeyDown={(e) => handleKeyDown(e, 'chat')} style={{ opacity: isStreaming ? 0.6 : 1 }} />
                    <div className="chat-input-actions">
                      <button className="attach-btn" title="Attach files" onClick={() => fileInputRef.current?.click()}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                        </svg>
                      </button>
                      <button className="model-btn" onClick={toggleModel} style={{ padding: '6px 8px', fontSize: '12px' }}>
                        <span id="chatCurrentModel">Sonnet 4</span>
                      </button>
                      <button className="send-btn" onClick={handleChatMessage} disabled={isStreaming} style={{ opacity: isStreaming ? 0.6 : 1 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background-color: #1a1a1a; color: #e5e5e5; height: 100vh; overflow: hidden; }
        .container { display: flex; height: 100vh; }

        /* Sidebar */
        .sidebar { width: 280px; background-color: #262626; border-right: 1px solid #404040; display: flex; flex-direction: column; position: relative; }
        .sidebar-header { padding: 16px; border-bottom: 1px solid #404040; }
        .logo { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; color: #fff; margin-bottom: 16px; }
        .claude-logo { width: 24px; height: 24px; border-radius: 6px; }
        .back-arrow { width: 20px; height: 20px; opacity: 0.7; }
        .new-chat-btn { display: flex; align-items: center; gap: 8px; background: none; border: none; color: #ff6b35; font-size: 14px; padding: 8px 0; cursor: pointer; transition: opacity 0.2s; }
        .new-chat-btn:hover { opacity: 0.8; }
        .plus-icon { width: 16px; height: 16px; background-color: #ff6b35; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: white; }
        .sidebar-nav { padding: 16px; border-bottom: 1px solid #404040; display: flex; flex-direction: column; gap: 4px; }
        .nav-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; color: #b3b3b3; font-size: 14px; cursor: pointer; transition: all 0.15s; border-radius: 6px; position: relative; }
        .nav-item:hover { color: #fff; background-color: #333; }
        .nav-item-active { color: #fff !important; background-color: #404040 !important; }
        .nav-item-active .nav-icon { opacity: 1; }
        .nav-icon { width: 16px; height: 16px; opacity: 0.7; flex-shrink: 0; }
        .nav-badge { position: absolute; right: 8px; background-color: #ff6b35; color: white; font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 600; }
        .sidebar-content { flex: 1; padding: 16px; overflow-y: auto; }
        .section-title { font-size: 12px; color: #808080; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        .recent-items { min-height: 20px; }
        .recent-item-wrapper { position: relative; }
        .recent-item { padding: 8px 12px; color: #b3b3b3; font-size: 13px; cursor: pointer; transition: all 0.15s; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 6px; }
        .recent-item:hover { color: #fff; background-color: #333; }
        .recent-item-wrapper:hover .delete-btn { opacity: 1; }
        .delete-btn { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #808080; cursor: pointer; padding: 4px; border-radius: 4px; opacity: 0; transition: all 0.15s; }
        .delete-btn:hover { color: #ff6b6b; background-color: #404040; }
        .delete-confirm { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 4px; background: #2a2a2a; border: 1px solid #404040; border-radius: 6px; padding: 2px 6px; font-size: 11px; z-index: 10; }
        .delete-confirm span { color: #b3b3b3; }
        .delete-yes { background: #dc2626; color: white; border: none; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
        .delete-no { background: #404040; color: white; border: none; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
        .empty-state { padding: 16px 0; text-align: center; color: #666; font-size: 13px; font-style: italic; }

        /* Projects panel */
        .projects-panel { padding: 8px 0; }
        .projects-empty { display: flex; flex-direction: column; align-items: center; padding: 24px 12px; }
        .projects-features { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; width: 100%; }
        .project-feature-item { display: flex; align-items: center; gap: 10px; color: #b3b3b3; font-size: 13px; padding: 8px 12px; background-color: #2a2a2a; border-radius: 6px; }

        /* Artifacts sidebar */
        .artifact-sidebar-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; border-radius: 6px; transition: all 0.15s; }
        .artifact-sidebar-item:hover { background-color: #333; }
        .artifact-sidebar-lang { font-size: 10px; font-weight: 700; color: #ff6b35; background-color: #2a2a2a; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; flex-shrink: 0; }
        .artifact-sidebar-info { flex: 1; overflow: hidden; }
        .artifact-sidebar-title { font-size: 12px; color: #b3b3b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .artifact-sidebar-meta { font-size: 11px; color: #666; }

        /* User menu */
        .sidebar-footer { padding: 16px; border-top: 1px solid #404040; position: relative; }
        .user-info { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px; border-radius: 6px; transition: background-color 0.15s; }
        .user-info:hover { background-color: #333; }
        .user-avatar { width: 24px; height: 24px; background-color: #ff6b35; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: white; flex-shrink: 0; }
        .user-details { flex: 1; overflow: hidden; }
        .user-name { font-size: 14px; color: #fff; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .user-plan { font-size: 12px; color: #808080; }
        .chevron-down { width: 16px; height: 16px; opacity: 0.5; transition: transform 0.2s; flex-shrink: 0; }
        .chevron-up { transform: rotate(180deg); }
        .user-menu { position: absolute; bottom: 70px; left: 16px; right: 16px; background-color: #2a2a2a; border: 1px solid #404040; border-radius: 10px; padding: 8px; z-index: 100; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
        .user-menu-header { display: flex; align-items: center; gap: 10px; padding: 12px 8px; }
        .user-menu-avatar { width: 36px; height: 36px; background-color: #ff6b35; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; color: white; flex-shrink: 0; }
        .user-menu-name { font-size: 15px; color: #fff; font-weight: 600; outline: none; border-bottom: 1px dashed transparent; padding: 1px 0; }
        .user-menu-name:focus { border-bottom-color: #ff6b35; }
        .user-menu-plan { font-size: 12px; color: #808080; margin-top: 2px; }
        .user-menu-divider { height: 1px; background-color: #404040; margin: 4px 0; }
        .user-menu-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; color: #b3b3b3; font-size: 13px; cursor: pointer; border-radius: 6px; transition: all 0.15s; }
        .user-menu-item:hover { background-color: #404040; color: #fff; }
        .user-menu-footer { font-size: 11px !important; color: #555 !important; justify-content: center; cursor: default !important; padding: 8px !important; }
        .user-menu-footer:hover { background-color: transparent !important; color: #555 !important; }

        /* Main Content - full viewport height, no overflow */
        .main-content { flex: 1; height: 100vh; overflow: hidden; display: flex; flex-direction: column; background-color: #1a1a1a; min-width: 0; }

        /* Welcome screen - centered, scrollable if needed */
        .welcome-screen { height: 100%; display: flex; align-items: center; justify-content: center; overflow-y: auto; padding: 20px; }
        .welcome-inner { max-width: 600px; width: 100%; display: flex; flex-direction: column; align-items: center; padding: 40px 0; }

        /* Chat view - fills entire main-content, column layout */
        .chat-view { height: 100%; display: flex; flex-direction: column; }

        /* Chat messages - scrollable area */
        .chat-messages { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 20px; min-height: 0; scrollbar-width: thin; scrollbar-color: #404040 #262626; scroll-behavior: smooth; }
        .chat-messages::-webkit-scrollbar { width: 8px; }
        .chat-messages::-webkit-scrollbar-track { background: #262626; border-radius: 4px; }
        .chat-messages::-webkit-scrollbar-thumb { background: #404040; border-radius: 4px; }
        .chat-messages::-webkit-scrollbar-thumb:hover { background: #555; }
        .message { margin-bottom: 24px; display: flex; gap: 12px; }
        .message.user { flex-direction: row-reverse; }
        .message-avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; flex-shrink: 0; }
        .message.user .message-avatar { background-color: #ff6b35; color: white; }
        .message.assistant .message-avatar { background-color: #4a90e2; color: white; }
        .message-content { max-width: 70%; background-color: #262626; border-radius: 12px; padding: 16px; color: #e5e5e5; line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word; white-space: pre-wrap; }
        .message.assistant .message-content { padding: 0; }
        .message-text-part { padding: 16px; white-space: pre-wrap; }
        .message.user .message-content { background-color: #ff6b35; color: white; padding: 16px; }

        /* Attachments in messages */
        .attachments-preview-in-message { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 12px 0 12px; }
        .attachment-chip-in-message { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 6px 10px; max-width: 240px; }
        .attachment-thumb-in-message { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; }
        .attachment-info-in-message { display: flex; flex-direction: column; overflow: hidden; }
        .attachment-name-in-message { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .attachment-size-in-message { font-size: 11px; opacity: 0.7; }

        /* Typing indicator */
        .typing-indicator { display: none; align-items: center; gap: 8px; color: #808080; font-style: italic; padding: 16px; }
        .typing-dots { display: flex; gap: 4px; }
        .typing-dot { width: 6px; height: 6px; background-color: #808080; border-radius: 50%; animation: typing 1.4s infinite ease-in-out; }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes typing { 0%, 80%, 100% { transform: scale(1); opacity: 0.5; } 40% { transform: scale(1.2); opacity: 1; } }
        .greeting { display: flex; align-items: center; gap: 12px; margin-bottom: 40px; font-size: 32px; font-weight: 400; color: #fff; }
        .sun-icon { width: 32px; height: 32px; color: #ff6b35; }

        /* Search / Input (welcome screen) */
        .search-container { width: 100%; max-width: 600px; position: relative; margin-bottom: 20px; }
        .search-input { width: 100%; padding: 16px 160px 16px 16px; background-color: #262626; border: 1px solid #404040; border-radius: 12px; color: #fff; font-size: 16px; outline: none; transition: border-color 0.2s; resize: none; min-height: 50px; max-height: 150px; font-family: inherit; }
        .search-input:focus { border-color: #ff6b35; }
        .search-input::placeholder { color: #808080; }
        .search-actions { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; gap: 4px; align-items: center; }

        /* Chat input area - always visible at bottom */
        .chat-input-area { flex-shrink: 0; padding: 10px 20px 20px; }
        .chat-input-inner { max-width: 700px; margin: 0 auto; }
        .chat-input-row { position: relative; display: flex; align-items: flex-end; gap: 8px; background-color: #262626; border: 1px solid #404040; border-radius: 12px; padding: 8px 8px 8px 16px; transition: border-color 0.2s; }
        .chat-input-row:focus-within { border-color: #ff6b35; }
        .chat-textarea { flex: 1; background: none; border: none; color: #fff; font-size: 16px; outline: none; resize: none; min-height: 36px; max-height: 150px; padding: 8px 0; font-family: inherit; line-height: 1.4; }
        .chat-textarea::placeholder { color: #808080; }
        .chat-input-actions { display: flex; gap: 4px; align-items: center; flex-shrink: 0; padding-bottom: 2px; }
        .search-btn { padding: 8px; background: none; border: none; color: #808080; cursor: pointer; border-radius: 6px; transition: background-color 0.2s; font-size: 13px; }
        .search-btn:hover { background-color: #404040; }
        .attach-btn { padding: 6px; background: none; border: none; color: #808080; cursor: pointer; border-radius: 6px; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
        .attach-btn:hover { background-color: #404040; color: #ff6b35; }
        .send-btn { padding: 8px; background-color: #ff6b35; border: none; color: white; cursor: pointer; border-radius: 6px; transition: background-color 0.2s; display: flex; align-items: center; justify-content: center; }
        .send-btn:hover { background-color: #e55a2b; }
        .send-btn:disabled { background-color: #404040; cursor: not-allowed; }
        .model-selector { align-self: flex-end; margin-bottom: 20px; margin-right: 60px; }
        .model-btn { display: flex; align-items: center; gap: 8px; background: none; border: none; color: #b3b3b3; font-size: 14px; cursor: pointer; padding: 8px 12px; border-radius: 6px; transition: background-color 0.2s; }
        .model-btn:hover { background-color: #262626; }
        .action-buttons { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
        .action-btn { display: flex; align-items: center; gap: 8px; padding: 12px 20px; background-color: #262626; border: 1px solid #404040; border-radius: 8px; color: #e5e5e5; font-size: 14px; cursor: pointer; transition: all 0.2s; text-decoration: none; }
        .action-btn:hover { background-color: #333; border-color: #555; transform: translateY(-1px); }
        .action-icon { width: 16px; height: 16px; opacity: 0.8; }
        .auth-box { max-width: 600px; marginBottom: '15px'; padding: 12px; background-color: #2a2a2a; border-radius: 8px; border: 1px solid #404040; }

        /* Attachments bar */
        .attachments-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; padding: 0 4px; }
        .attachment-chip { display: flex; align-items: center; gap: 8px; background-color: #2a2a2a; border: 1px solid #404040; border-radius: 8px; padding: 6px 10px; max-width: 220px; transition: border-color 0.2s; }
        .attachment-chip:hover { border-color: #ff6b35; }
        .attachment-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: 4px; }
        .attachment-info { display: flex; flex-direction: column; overflow: hidden; }
        .attachment-name { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
        .attachment-size { font-size: 11px; color: #808080; }
        .attachment-remove { background: none; border: none; color: #808080; cursor: pointer; padding: 2px; font-size: 12px; flex-shrink: 0; border-radius: 4px; }
        .attachment-remove:hover { color: #ff6b6b; background-color: #404040; }

        /* Attachment states */
        .attachment-chip-loading { border-color: #4a90e2; background-color: rgba(74, 144, 226, 0.08); }
        .attachment-chip-ready { border-color: #22c55e; }
        .attachment-chip-error { border-color: #dc2626; background-color: rgba(220, 38, 38, 0.08); }
        .attachment-spinner { width: 24px; height: 24px; border: 2px solid #404040; border-top-color: #4a90e2; border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .attachment-file-icon { font-size: 20px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .attachment-error-icon { font-size: 20px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .attachment-size-loading { color: #4a90e2 !important; }

        /* Upload Toast */
        .upload-toast { position: fixed; top: 20px; right: 20px; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 10px; color: #fff; font-size: 14px; z-index: 10000; box-shadow: 0 8px 32px rgba(0,0,0,0.5); animation: slideIn 0.3s ease-out; max-width: 400px; }
        .upload-toast-success { background: linear-gradient(135deg, #16a34a, #22c55e); }
        .upload-toast-error { background: linear-gradient(135deg, #b91c1c, #dc2626); }
        .upload-toast-info { background: linear-gradient(135deg, #1d4ed8, #3b82f6); }
        @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .upload-toast-icon { flex-shrink: 0; display: flex; align-items: center; }
        .upload-toast span { flex: 1; }
        .upload-toast-close { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; padding: 2px 4px; font-size: 12px; border-radius: 4px; flex-shrink: 0; }
        .upload-toast-close:hover { color: #fff; background: rgba(255,255,255,0.2); }

        /* Artifacts */
        .artifact-canvas { background-color: #0d0d0d; border: 1px solid #404040; border-radius: 8px; margin: 16px; overflow: hidden; }
        .artifact-header { display: flex; justify-content: space-between; align-items: center; background-color: #2a2a2a; padding: 8px 12px; border-bottom: 1px solid #404040; }
        .artifact-title { font-size: 13px; font-weight: 500; color: #b3b3b3; }
        .artifact-actions { display: flex; gap: 8px; }
        .artifact-btn { background: none; border: 1px solid #555; color: #b3b3b3; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px; transition: all 0.2s; }
        .artifact-btn:hover { background-color: #404040; color: #fff; }
        .artifact-btn.view-btn { border-color: #4a90e2; color: #4a90e2; }
        .artifact-btn.view-btn:hover { background-color: #4a90e2; color: #fff; }
        .artifact-btn svg { width: 14px; height: 14px; }
        .artifact-code { padding: 12px; max-height: 400px; overflow: auto; scrollbar-width: thin; scrollbar-color: #404040 #1a1a1a; }
        .artifact-code pre { margin: 0; }
        .artifact-code code { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 13px; color: #e5e5e5; white-space: pre; }

        @media (max-width: 768px) {
          .sidebar { width: 240px; }
          .greeting { font-size: 24px; }
          .action-buttons { flex-direction: column; width: 100%; }
          .action-btn { justify-content: center; }
          .message-content { max-width: 85%; }
        }
      `}</style>
    </>
  );
}
