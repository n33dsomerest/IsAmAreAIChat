// app.js — IsAmAre AI Chat Application
// Uses global: CONFIG (from config.js), marked, DOMPurify, hljs

(function() {
    'use strict';

    // DOM Elements
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('toggle-sidebar-btn');
    const mobileToggleBtn = document.getElementById('mobile-sidebar-toggle');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatHistoryList = document.getElementById('chat-history-list');
    const messageInput = document.getElementById('message-input');
    const chatForm = document.getElementById('chat-form');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');
    const welcomeScreen = document.getElementById('welcome-screen');
    const fileInput = document.getElementById('file-input');
    const attachBtn = document.getElementById('attach-btn');
    const filePreviewContainer = document.getElementById('file-preview-container');
    const stopBtn = document.getElementById('stop-btn');
    const modelSelector = document.getElementById('model-selector');
    const modelSelectorBtn = document.getElementById('model-selector-btn');
    const modelSelectorLabel = document.getElementById('model-selector-label');
    const modelDropdown = document.getElementById('model-dropdown');
    
    // Header Actions
    const settingsBtn = document.getElementById('settings-btn');
    const exportBtn = document.getElementById('export-btn');

    // Settings DOM
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const systemPromptInput = document.getElementById('system-prompt-input');

    // Onboarding DOM
    const onboardingOverlay = document.getElementById('onboarding-overlay');
    const onboardingForm = document.getElementById('onboarding-form');
    const onboardingNameInput = document.getElementById('onboarding-name-input');
    const displayUserName = document.getElementById('display-user-name');
    const displayUserAvatar = document.getElementById('display-user-avatar');

    // State
    let sessions = [];
    let currentSessionId = null;
    let isGenerating = false;
    let currentAbortController = null;
    let pendingFiles = []; // Array of { file, type, dataUrl, textContent }
    let selectedModel = localStorage.getItem('ai_chat_selected_model') || CONFIG.DEFAULT_MODEL;
    let systemPrompt = localStorage.getItem('ai_chat_system_prompt') || '';
    let userName = localStorage.getItem('ai_chat_username') || '';

    // Load sessions from localStorage safely
    function loadSessionsFromStorage() {
        try {
            var raw = localStorage.getItem('ai_chat_sessions');
            if (raw) {
                sessions = JSON.parse(raw);
            }
        } catch (e) {
            console.warn('Failed to parse sessions from localStorage:', e);
            sessions = [];
        }
    }

    // Configure marked for markdown rendering
    function configureMarked() {
        var renderer = new marked.Renderer();
        
        renderer.code = function(tokenOrCode, language) {
            var code = typeof tokenOrCode === 'string' ? tokenOrCode : (tokenOrCode ? tokenOrCode.text : '');
            var lang = language || (typeof tokenOrCode === 'object' && tokenOrCode.lang) || 'text';
            var escapedCode = code.replace(/&/g, '&amp;')
                                 .replace(/</g, '&lt;')
                                 .replace(/>/g, '&gt;');

            return '<div class="code-block-wrapper">' +
                   '<div class="code-header">' +
                   '<span class="code-lang">' + lang + '</span>' +
                   '<button class="copy-btn">' +
                   '<svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>' +
                   '<span class="copy-text">Copy</span>' +
                   '</button>' +
                   '</div>' +
                   '<pre><code class="language-' + lang + '">' + escapedCode + '</code></pre>' +
                   '</div>';
        };

        marked.setOptions({
            renderer: renderer,
            breaks: true,
            gfm: true
        });
    }

    // Setup Initial State
    function init() {
        checkOnboarding();
        loadSessionsFromStorage();
        configureMarked();
        initModelSelector();
        renderHistoryList();

        if (sessions.length > 0) {
            loadSession(sessions[0].id);
        } else {
            createNewSession();
        }

        // Auto-resize textarea
        messageInput.addEventListener('input', handleTextareaInput);

        // Enter to send (Shift+Enter for new line)
        messageInput.addEventListener('keydown', handleTextareaKeydown);

        // Keep the latest message in view above the on-screen keyboard.
        // The visualViewport API reports the actual visible area, so when
        // the keyboard slides up the height shrinks — we recompute and
        // scroll on every change.
        if (window.visualViewport) {
            // Set initial height, then keep it in sync on every change.
            syncChatHeight();
            window.visualViewport.addEventListener('resize', () => {
                syncChatHeight();
                scrollToBottom();
            });
        }
        messageInput.addEventListener('focus', () => {
            // Small delay lets the keyboard finish its open animation.
            setTimeout(() => {
                syncChatHeight();
                scrollToBottom();
            }, 200);
        });
        messageInput.addEventListener('blur', () => {
            syncChatHeight();
            scrollToBottom();
        });

        // Form submit
        chatForm.addEventListener('submit', handleSend);

        // Sidebar toggles
        if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
        if (mobileToggleBtn) mobileToggleBtn.addEventListener('click', openSidebar);
        if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

        // New Chat button
        newChatBtn.addEventListener('click', createNewSession);

        // File upload
        attachBtn.addEventListener('click', function() {
            fileInput.click();
        });
        fileInput.addEventListener('change', handleFileSelect);

        // Stop Generation
        stopBtn.addEventListener('click', function() {
            if (currentAbortController) {
                currentAbortController.abort();
            }
        });

        // Drag & Drop on the input form
        chatForm.addEventListener('dragover', function(e) {
            e.preventDefault();
            chatForm.classList.add('drag-over');
        });
        chatForm.addEventListener('dragleave', function(e) {
            e.preventDefault();
            chatForm.classList.remove('drag-over');
        });
        chatForm.addEventListener('drop', function(e) {
            e.preventDefault();
            chatForm.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                processFiles(e.dataTransfer.files);
            }
        });

        // Paste image from clipboard
        messageInput.addEventListener('paste', function(e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            for (var i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    var file = items[i].getAsFile();
                    if (file) {
                        processFiles([file]);
                    }
                }
            }
        });

        // Model selector toggle
        modelSelectorBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!modelSelector.classList.contains('open')) {
                // Opening - clear search and show all
                var searchInput = document.querySelector('.model-search-input');
                if (searchInput) {
                    searchInput.value = '';
                }
                renderModelOptions('');
            }
            modelSelector.classList.toggle('open');
            if (modelSelector.classList.contains('open')) {
                var searchInput = document.querySelector('.model-search-input');
                if (searchInput) {
                    setTimeout(function() { searchInput.focus(); }, 100);
                }
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            if (!modelSelector.contains(e.target)) {
                modelSelector.classList.remove('open');
            }
        });

        // Copy button event delegation
        chatMessages.addEventListener('click', function(e) {
            var copyBtn = e.target.closest('.copy-btn');
            if (copyBtn) {
                handleCopyCode(copyBtn);
            }
        });

        // Settings Modal
        settingsBtn.addEventListener('click', openSettings);
        closeSettingsBtn.addEventListener('click', closeSettings);
        cancelSettingsBtn.addEventListener('click', closeSettings);
        saveSettingsBtn.addEventListener('click', saveSettings);

        // Export
        if (exportBtn) exportBtn.addEventListener('click', exportChat);
    }

    // --- Onboarding ---
    function checkOnboarding() {
        if (!userName) {
            if (onboardingOverlay) onboardingOverlay.style.display = 'flex';
            if (onboardingForm) {
                onboardingForm.addEventListener('submit', function(e) {
                    e.preventDefault();
                    var name = onboardingNameInput.value.trim();
                    if (name) {
                        userName = name;
                        localStorage.setItem('ai_chat_username', userName);
                        onboardingOverlay.style.opacity = '0';
                        setTimeout(function() {
                            onboardingOverlay.style.display = 'none';
                        }, 300);
                        updateUserProfile();
                    }
                });
            }
        } else {
            if (onboardingOverlay) onboardingOverlay.style.display = 'none';
            updateUserProfile();
        }
    }

    function updateUserProfile() {
        if (displayUserName) displayUserName.textContent = userName || 'Local User';
        if (displayUserAvatar) {
            displayUserAvatar.textContent = userName ? userName.charAt(0).toUpperCase() : 'U';
            // Optional: Generate a random color based on name for avatar background
            if (userName) {
                var hash = 0;
                for (var i = 0; i < userName.length; i++) {
                    hash = userName.charCodeAt(i) + ((hash << 5) - hash);
                }
                var c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
                displayUserAvatar.style.backgroundColor = '#' + ('00000'.substring(0, 6 - c.length) + c);
            }
        }
    }

    function exportChat() {
        var currentSession = sessions.find(function(s) { return s.id === currentSessionId; });
        if (!currentSession || currentSession.messages.length === 0) {
            alert('ไม่มีประวัติการสนทนาให้ Export');
            return;
        }

        var mdContent = '# ' + currentSession.title + '\n\n';
        mdContent += '*Exported from IsAmAre AI Chat*\n\n---\n\n';

        currentSession.messages.forEach(function(msg) {
            var roleName = msg.role === 'user' ? '👤 **You**' : '🤖 **AI**';
            mdContent += '### ' + roleName + '\n\n';
            mdContent += msg.content + '\n\n';
            
            if (msg.attachments && msg.attachments.length > 0) {
                mdContent += '*ไฟล์แนบ: ' + msg.attachments.map(function(a) { return a.name; }).join(', ') + '*\n\n';
            }
            mdContent += '---\n\n';
        });

        var blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        
        // Use session title for filename, fallback to generic name
        var filename = currentSession.title.replace(/[^a-z0-9ก-๙]/gi, '_').toLowerCase();
        if (filename === 'new_chat') filename = 'chat_export';
        
        a.href = url;
        a.download = filename + '_' + Date.now() + '.md';
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        setTimeout(function() {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);
    }

    function openSettings() {
        systemPromptInput.value = systemPrompt;
        settingsModal.classList.add('open');
    }

    function closeSettings() {
        settingsModal.classList.remove('open');
    }

    function saveSettings() {
        systemPrompt = systemPromptInput.value.trim();
        localStorage.setItem('ai_chat_system_prompt', systemPrompt);
        closeSettings();
    }

    function handleCopyCode(btn) {
        var wrapper = btn.closest('.code-block-wrapper');
        if (!wrapper) return;
        
        var codeElement = wrapper.querySelector('code');
        if (!codeElement) return;

        var textToCopy = codeElement.textContent;

        navigator.clipboard.writeText(textToCopy).then(function() {
            var originalHtml = btn.innerHTML;
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg><span class="copy-text" style="color:#4ade80;">Copied!</span>';
            btn.classList.add('copied');
            
            setTimeout(function() {
                btn.innerHTML = originalHtml;
                btn.classList.remove('copied');
            }, 2000);
        }).catch(function(err) {
            console.error('Failed to copy code: ', err);
        });
    }

    // --- Model Selector ---
    var modelIcons = ['🤖', '🟢', '🌊', '💡'];

    function initModelSelector() {
        renderModelDropdown();
        // Set initial label from selectedModel
        var currentModel = CONFIG.AVAILABLE_MODELS.find(function(m) { return m.id === selectedModel; });
        if (currentModel) {
            modelSelectorLabel.textContent = currentModel.label;
        }
    }

    function renderModelDropdown() {
        modelDropdown.innerHTML = '';

        var header = document.createElement('div');
        header.className = 'model-dropdown-header';
        header.textContent = 'เลือกโมเดล AI';
        modelDropdown.appendChild(header);

        var searchContainer = document.createElement('div');
        searchContainer.className = 'model-dropdown-search';
        
        var searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'model-search-input';
        searchInput.placeholder = 'ค้นหาโมเดล...';
        searchInput.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        searchInput.addEventListener('input', function(e) {
            renderModelOptions(e.target.value);
        });
        
        searchContainer.appendChild(searchInput);
        modelDropdown.appendChild(searchContainer);

        var listContainer = document.createElement('div');
        listContainer.className = 'model-dropdown-list';
        listContainer.id = 'model-dropdown-list';
        modelDropdown.appendChild(listContainer);

        renderModelOptions('');
    }

    function renderModelOptions(filterText) {
        var listContainer = document.getElementById('model-dropdown-list');
        if (!listContainer) return;
        
        listContainer.innerHTML = '';
        var lowerFilter = (filterText || '').toLowerCase();

        CONFIG.AVAILABLE_MODELS.forEach(function(model, index) {
            if (lowerFilter && !model.label.toLowerCase().includes(lowerFilter) && !model.id.toLowerCase().includes(lowerFilter)) {
                return;
            }

            var option = document.createElement('button');
            option.className = 'model-option' + (model.id === selectedModel ? ' active' : '');

            var iconDiv = document.createElement('div');
            iconDiv.className = 'model-option-icon';
            if (model.icon) {
                var img = document.createElement('img');
                var baseUrl = 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/';
                img.src = baseUrl + model.icon + '-color.svg';
                img.style.width = '20px';
                img.style.height = '20px';
                img.style.objectFit = 'contain';
                
                var tryMono = false;
                img.onerror = function() {
                    if (!tryMono) {
                        tryMono = true;
                        img.src = baseUrl + model.icon + '.svg';
                    } else {
                        iconDiv.innerHTML = '';
                        iconDiv.textContent = modelIcons[index % modelIcons.length];
                    }
                };
                iconDiv.appendChild(img);
            } else {
                iconDiv.textContent = modelIcons[index % modelIcons.length];
            }

            var infoDiv = document.createElement('div');
            infoDiv.className = 'model-option-info';

            var nameSpan = document.createElement('span');
            nameSpan.className = 'model-option-name';
            nameSpan.textContent = model.label;

            var idSpan = document.createElement('span');
            idSpan.className = 'model-option-id';
            idSpan.textContent = model.id;

            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(idSpan);

            var checkSvg = document.createElement('span');
            checkSvg.className = 'model-option-check';
            checkSvg.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>';

            option.appendChild(iconDiv);
            option.appendChild(infoDiv);
            option.appendChild(checkSvg);

            option.addEventListener('click', function(e) {
                e.stopPropagation();
                selectModel(model);
            });

            listContainer.appendChild(option);
        });
    }

    function selectModel(model) {
        selectedModel = model.id;
        localStorage.setItem('ai_chat_selected_model', model.id);

        // Update button label
        modelSelectorLabel.textContent = model.label;

        // Update button icon
        var btnIcon = document.querySelector('.model-selector-btn .model-selector-icon') || document.querySelector('.model-selector-btn img.model-selector-icon');
        if (btnIcon && model.icon) {
            var img = document.createElement('img');
            var baseUrl = 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/';
            img.src = baseUrl + model.icon + '-color.svg';
            img.className = 'model-selector-icon';
            img.style.width = '16px';
            img.style.height = '16px';
            img.style.objectFit = 'contain';
            
            var tryMono = false;
            img.onerror = function() {
                if (!tryMono) {
                    tryMono = true;
                    img.src = baseUrl + model.icon + '.svg';
                }
            };
            
            // Keep the original SVG as a fallback if we had it, but simpler is just not worry
            btnIcon.parentNode.replaceChild(img, btnIcon);
        }

        // Re-render options to update active state without losing search
        var searchInput = document.querySelector('.model-search-input');
        renderModelOptions(searchInput ? searchInput.value : '');

        // Close dropdown
        modelSelector.classList.remove('open');
    }

    // --- File Handling ---
    function handleFileSelect(e) {
        if (e.target.files.length > 0) {
            processFiles(e.target.files);
            fileInput.value = ''; // Reset so same file can be re-selected
        }
    }

    function processFiles(fileList) {
        Array.from(fileList).forEach(function(file) {
            // Limit to 10 files
            if (pendingFiles.length >= 10) {
                alert('สามารถแนบได้สูงสุด 10 ไฟล์');
                return;
            }

            // Limit file size (10MB for images, 1MB for text)
            var isImage = file.type.startsWith('image/');
            var maxSize = isImage ? 10 * 1024 * 1024 : 1 * 1024 * 1024;

            if (file.size > maxSize) {
                alert('ไฟล์ "' + file.name + '" มีขนาดใหญ่เกินไป (สูงสุด ' + (isImage ? '10MB' : '1MB') + ')');
                return;
            }

            if (isImage) {
                readFileAsDataUrl(file);
            } else {
                readFileAsText(file);
            }
        });
    }

    function readFileAsDataUrl(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var entry = {
                file: file,
                type: 'image',
                dataUrl: e.target.result,
                textContent: null
            };
            pendingFiles.push(entry);
            renderFilePreviews();
            updateSendButton();
        };
        reader.readAsDataURL(file);
    }

    function readFileAsText(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var entry = {
                file: file,
                type: 'text',
                dataUrl: null,
                textContent: e.target.result
            };
            pendingFiles.push(entry);
            renderFilePreviews();
            updateSendButton();
        };
        reader.onerror = function() {
            alert('ไม่สามารถอ่านไฟล์ "' + file.name + '" ได้');
        };
        reader.readAsText(file);
    }

    function removeFile(index) {
        pendingFiles.splice(index, 1);
        renderFilePreviews();
        updateSendButton();
    }

    function renderFilePreviews() {
        filePreviewContainer.innerHTML = '';

        pendingFiles.forEach(function(entry, index) {
            var chip = document.createElement('div');
            chip.className = 'file-preview-chip' + (entry.type === 'image' ? ' image-chip' : '');

            if (entry.type === 'image') {
                var img = document.createElement('img');
                img.className = 'file-thumb';
                img.src = entry.dataUrl;
                img.alt = entry.file.name;
                chip.appendChild(img);
            } else {
                // File icon
                var iconSpan = document.createElement('span');
                iconSpan.className = 'file-icon';
                iconSpan.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
                chip.appendChild(iconSpan);

                // File name
                var nameSpan = document.createElement('span');
                nameSpan.className = 'file-name';
                nameSpan.textContent = entry.file.name;
                chip.appendChild(nameSpan);
            }

            // Remove button
            var removeBtn = document.createElement('button');
            removeBtn.className = 'file-remove-btn';
            removeBtn.innerHTML = '✕';
            removeBtn.addEventListener('click', function() {
                removeFile(index);
            });
            chip.appendChild(removeBtn);

            filePreviewContainer.appendChild(chip);
        });
    }

    function clearPendingFiles() {
        pendingFiles = [];
        filePreviewContainer.innerHTML = '';
    }

    // --- Textarea Handlers ---
    function handleTextareaInput() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
        updateSendButton();
    }

    function handleTextareaKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) {
                chatForm.dispatchEvent(new Event('submit'));
            }
        }
    }

    function updateSendButton() {
        var hasText = messageInput.value.trim().length > 0;
        var hasFiles = pendingFiles.length > 0;
        sendBtn.disabled = (!hasText && !hasFiles) || isGenerating;
    }

    // --- Sidebar ---
    function toggleSidebar() {
        sidebar.classList.toggle('collapsed');
    }

    function openSidebar() {
        sidebar.classList.remove('collapsed');
        sidebar.classList.add('open');
        if (sidebarOverlay) sidebarOverlay.classList.add('show');
    }

    function closeSidebar() {
        // Only collapse on mobile or if explicitly needed
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('open');
            if (sidebarOverlay) sidebarOverlay.classList.remove('show');
        }
    }

    // --- Session Management ---
    function createNewSession() {
        var newSession = {
            id: Date.now().toString(),
            title: 'New Chat',
            messages: []
        };
        sessions.unshift(newSession);
        currentSessionId = newSession.id;
        saveSessions();
        renderHistoryList();
        renderMessages();
    }

    function saveSessions() {
        try {
            localStorage.setItem('ai_chat_sessions', JSON.stringify(sessions));
        } catch (e) {
            console.error('Failed to save sessions to localStorage:', e);
            // If quota exceeded, try to trim old sessions
            if (e.name === 'QuotaExceededError') {
                trimOldSessions();
            }
        }
    }

    function trimOldSessions() {
        // Remove image data from old sessions to save space
        if (sessions.length > 5) {
            sessions = sessions.slice(0, 5);
        }
        sessions.forEach(function(session) {
            session.messages.forEach(function(msg) {
                if (msg.attachments) {
                    msg.attachments.forEach(function(att) {
                        if (att.type === 'image') {
                            att.dataUrl = '[image removed to save space]';
                        }
                    });
                }
            });
        });
        try {
            localStorage.setItem('ai_chat_sessions', JSON.stringify(sessions));
        } catch (e) {
            console.error('Still unable to save after trimming:', e);
        }
    }

    function deleteSession(id) {
        sessions = sessions.filter(function(s) { return s.id !== id; });
        saveSessions();

        if (currentSessionId === id) {
            if (sessions.length > 0) {
                loadSession(sessions[0].id);
            } else {
                createNewSession();
            }
        } else {
            renderHistoryList();
        }
    }

    function loadSession(id) {
        currentSessionId = id;
        renderHistoryList();
        renderMessages();

        // On mobile, hide sidebar after selecting a chat
        if (window.innerWidth <= 768) {
            closeSidebar();
        }
    }

    // --- UI Rendering ---
    function renderHistoryList() {
        chatHistoryList.innerHTML = '';
        sessions.forEach(function(session) {
            var li = document.createElement('li');
            li.className = 'history-item' + (session.id === currentSessionId ? ' active' : '');

            // Chat icon
            var iconSpan = document.createElement('span');
            iconSpan.className = 'history-icon';
            iconSpan.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

            // Title
            var titleSpan = document.createElement('span');
            titleSpan.className = 'history-title';
            titleSpan.textContent = session.title;

            // Delete button
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'history-delete-btn';
            deleteBtn.title = 'Delete chat';
            deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            deleteBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteSession(session.id);
            });

            li.appendChild(iconSpan);
            li.appendChild(titleSpan);
            li.appendChild(deleteBtn);

            li.addEventListener('click', function() {
                loadSession(session.id);
            });

            chatHistoryList.appendChild(li);
        });
    }

    function renderMessages() {
        var currentSession = sessions.find(function(s) { return s.id === currentSessionId; });

        // Remove all message elements except welcome screen
        var elementsToRemove = chatMessages.querySelectorAll('.message-wrapper');
        elementsToRemove.forEach(function(el) { el.remove(); });

        if (currentSession && currentSession.messages.length > 0) {
            welcomeScreen.style.display = 'none';
            currentSession.messages.forEach(function(msg) {
                appendMessageToUI(msg.role, msg.content, false, msg.attachments || []);
            });
        } else {
            welcomeScreen.style.display = 'flex';
        }

        scrollToBottom();
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // On mobile, the soft keyboard shrinks the visualViewport. We set
    // a CSS variable so .chat-area can shrink with it, keeping the
    // latest message visible above the keyboard.
    function syncChatHeight() {
        if (!window.visualViewport) return;
        // visualViewport.height already excludes the keyboard on mobile
        // browsers that support it. We expose it to CSS and also push
        // the scroll to the bottom so the latest message lands above
        // the input bar.
        var h = window.visualViewport.height;
        document.documentElement.style.setProperty('--chat-height', h + 'px');
    }

    function appendMessageToUI(role, content, animate, attachments) {
        if (animate === undefined) animate = true;
        if (!attachments) attachments = [];

        welcomeScreen.style.display = 'none';

        var wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper ' + role;
        if (!animate) {
            wrapper.style.opacity = '1';
            wrapper.style.transform = 'none';
            wrapper.style.animation = 'none';
        }

        var avatar = document.createElement('div');
        avatar.className = 'avatar ' + (role === 'user' ? 'user-avatar' : 'bot-avatar');

        if (role === 'user') {
            avatar.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
        } else {
            avatar.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M12 12 2.1 7.1"></path><path d="M12 12l9.9 4.9"></path></svg>';
        }

        var msgContent = document.createElement('div');
        msgContent.className = 'message-content';

        // Render image attachments
        if (attachments.length > 0 && role === 'user') {
            var imageAtts = attachments.filter(function(a) { return a.type === 'image'; });
            var textAtts = attachments.filter(function(a) { return a.type === 'text'; });

            if (imageAtts.length > 0) {
                var imagesDiv = document.createElement('div');
                imagesDiv.className = 'message-images';
                imageAtts.forEach(function(att) {
                    if (att.dataUrl && att.dataUrl.indexOf('data:') === 0) {
                        var img = document.createElement('img');
                        img.src = att.dataUrl;
                        img.alt = att.name || 'Attached image';
                        imagesDiv.appendChild(img);
                    }
                });
                msgContent.appendChild(imagesDiv);
            }

            if (textAtts.length > 0) {
                textAtts.forEach(function(att) {
                    var label = document.createElement('div');
                    label.className = 'message-file-label';
                    label.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
                    var nameSpan = document.createElement('span');
                    nameSpan.textContent = att.name || 'file';
                    label.appendChild(nameSpan);
                    msgContent.appendChild(label);
                });
            }
        }

        // Render text content
        if (role === 'user') {
            var textNode = document.createElement('div');
            textNode.textContent = content;
            msgContent.appendChild(textNode);
        } else {
            // Parse Markdown and sanitize
            var rawHTML = marked.parse(content);
            var cleanHTML = DOMPurify.sanitize(rawHTML);
            msgContent.innerHTML = cleanHTML;
        }

        wrapper.appendChild(avatar);
        wrapper.appendChild(msgContent);
        chatMessages.appendChild(wrapper);

        scrollToBottom();

        // Apply highlight.js to new code blocks
        if (role === 'bot') {
            msgContent.querySelectorAll('pre code').forEach(function(block) {
                hljs.highlightElement(block);
            });
        }

        return msgContent;
    }

    // --- Thinking Indicator ---
    var thinkingTimerInterval = null;
    var thinkingStatusInterval = null;
    var thinkingStartTime = null;

    var thinkingStatuses = [
        { icon: '💭', text: 'กำลังคิด' },
        { icon: '🔍', text: 'วิเคราะห์ข้อความ' },
        { icon: '📚', text: 'หาข้อมูล' },
        { icon: '🧠', text: 'ประมวลผลคำตอบ' },
        { icon: '✨', text: 'เรียบเรียงข้อมูล' },
        { icon: '📝', text: 'จัดรูปแบบคำตอบ' }
    ];

    function appendThinkingIndicator() {
        var wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper bot typing-indicator-wrapper';
        wrapper.id = 'typing-indicator';

        var avatar = document.createElement('div');
        avatar.className = 'avatar bot-avatar';
        avatar.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M12 12 2.1 7.1"></path><path d="M12 12l9.9 4.9"></path></svg>';

        var msgContent = document.createElement('div');
        msgContent.className = 'message-content';
        msgContent.style.backgroundColor = 'transparent';

        var panel = document.createElement('div');
        panel.className = 'thinking-panel';

        // Header: icon + status text + dots
        var header = document.createElement('div');
        header.className = 'thinking-header';

        var iconEl = document.createElement('span');
        iconEl.className = 'thinking-icon';
        iconEl.id = 'thinking-icon';
        iconEl.textContent = '💭';

        var statusText = document.createElement('span');
        statusText.className = 'thinking-status-text';
        statusText.id = 'thinking-status-text';
        statusText.textContent = 'กำลังคิด';

        var dotsEl = document.createElement('span');
        dotsEl.className = 'thinking-dots';

        header.appendChild(iconEl);
        header.appendChild(statusText);
        header.appendChild(dotsEl);

        // Footer: timer + progress bar
        var footer = document.createElement('div');
        footer.className = 'thinking-footer';

        var timer = document.createElement('div');
        timer.className = 'thinking-timer';

        var timerDot = document.createElement('span');
        timerDot.className = 'thinking-timer-dot';

        var timerText = document.createElement('span');
        timerText.id = 'thinking-timer-text';
        timerText.textContent = '0:00';

        timer.appendChild(timerDot);
        timer.appendChild(timerText);

        var progress = document.createElement('div');
        progress.className = 'thinking-progress';

        var progressBar = document.createElement('div');
        progressBar.className = 'thinking-progress-bar';
        progress.appendChild(progressBar);

        footer.appendChild(timer);
        footer.appendChild(progress);

        panel.appendChild(header);
        panel.appendChild(footer);
        msgContent.appendChild(panel);

        wrapper.appendChild(avatar);
        wrapper.appendChild(msgContent);
        chatMessages.appendChild(wrapper);
        scrollToBottom();

        // Start timer
        thinkingStartTime = Date.now();
        thinkingTimerInterval = setInterval(function() {
            var elapsed = Math.floor((Date.now() - thinkingStartTime) / 1000);
            var mins = Math.floor(elapsed / 60);
            var secs = elapsed % 60;
            var timerEl = document.getElementById('thinking-timer-text');
            if (timerEl) {
                timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
            }
        }, 1000);

        // Rotate status messages
        var statusIndex = 0;
        thinkingStatusInterval = setInterval(function() {
            statusIndex = (statusIndex + 1) % thinkingStatuses.length;
            var iconElement = document.getElementById('thinking-icon');
            var textElement = document.getElementById('thinking-status-text');
            if (iconElement && textElement) {
                iconElement.textContent = thinkingStatuses[statusIndex].icon;
                textElement.textContent = thinkingStatuses[statusIndex].text;
            }
        }, 3000);
    }

    function removeThinkingIndicator() {
        // Clear intervals
        if (thinkingTimerInterval) {
            clearInterval(thinkingTimerInterval);
            thinkingTimerInterval = null;
        }
        if (thinkingStatusInterval) {
            clearInterval(thinkingStatusInterval);
            thinkingStatusInterval = null;
        }
        thinkingStartTime = null;

        var indicator = document.getElementById('typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    // Generate Chat Title automatically based on first message
    function updateSessionTitle(content) {
        var currentSession = sessions.find(function(s) { return s.id === currentSessionId; });
        if (currentSession && currentSession.messages.length === 1) {
            var title = content.substring(0, 30);
            if (content.length > 30) title += '...';
            currentSession.title = title;
            saveSessions();
            renderHistoryList();
        }
    }

    // --- Build API message content (multimodal support) ---
    function buildApiContent(text, attachments) {
        // If no attachments, return simple text string
        if (!attachments || attachments.length === 0) {
            return text;
        }

        // Build multimodal content array (OpenAI Vision format)
        var contentParts = [];

        // Add images first
        attachments.forEach(function(att) {
            if (att.type === 'image' && att.dataUrl && att.dataUrl.indexOf('data:') === 0) {
                contentParts.push({
                    type: 'image_url',
                    image_url: {
                        url: att.dataUrl
                    }
                });
            }
        });

        // Build text part: combine user text + any text file contents
        var textParts = [];
        if (text) {
            textParts.push(text);
        }

        attachments.forEach(function(att) {
            if (att.type === 'text' && att.textContent) {
                textParts.push('\n\n---\n📎 **' + att.name + ':**\n```\n' + att.textContent + '\n```');
            }
        });

        var combinedText = textParts.join('');

        if (combinedText) {
            contentParts.push({
                type: 'text',
                text: combinedText
            });
        }

        // If only text parts and no images, return as simple string
        var hasImages = contentParts.some(function(p) { return p.type === 'image_url'; });
        if (!hasImages) {
            return combinedText;
        }

        return contentParts;
    }

    // --- API Communication ---
    async function handleSend(e) {
        e.preventDefault();

        var text = messageInput.value.trim();
        var hasFiles = pendingFiles.length > 0;

        if ((!text && !hasFiles) || isGenerating) return;

        // Capture current files before clearing
        var currentFiles = pendingFiles.slice();

        // Build attachment metadata for storage
        var attachmentsMeta = currentFiles.map(function(entry) {
            return {
                type: entry.type,
                name: entry.file.name,
                dataUrl: entry.type === 'image' ? entry.dataUrl : null,
                textContent: entry.type === 'text' ? entry.textContent : null
            };
        });

        // Clear input
        messageInput.value = '';
        messageInput.style.height = 'auto';
        sendBtn.disabled = true;
        clearPendingFiles();

        var currentSession = sessions.find(function(s) { return s.id === currentSessionId; });
        if (!currentSession) return;

        // Save user message with attachments
        currentSession.messages.push({
            role: 'user',
            content: text || '(ไฟล์แนบ)',
            attachments: attachmentsMeta
        });
        updateSessionTitle(text || currentFiles[0].file.name);
        saveSessions();

        appendMessageToUI('user', text || '', true, attachmentsMeta);
        appendThinkingIndicator();
        isGenerating = true;
        
        // Show stop button
        stopBtn.classList.remove('hidden');
        // Small delay to allow CSS display:none to clear before adding active class for animation
        setTimeout(function() { stopBtn.classList.add('active'); }, 10);

        try {
            // Build message history for the API
            var apiMessages = currentSession.messages.map(function(m) {
                var role = m.role === 'bot' ? 'assistant' : 'user';
                var content = buildApiContent(m.content, m.attachments);
                return { role: role, content: content };
            });

            // Prepend system prompt if configured
            if (systemPrompt) {
                apiMessages.unshift({ role: 'system', content: systemPrompt });
            }

            currentAbortController = new AbortController();

            var selectedModelInfo = CONFIG.AVAILABLE_MODELS.find(function(m) { return m.id === selectedModel; });
            var provider = selectedModelInfo ? selectedModelInfo.provider : 'openrouter';

            var response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: selectedModel,
                    provider: provider,
                    messages: apiMessages,
                    stream: true,
                    userName: userName // Send username for tracking
                }),
                signal: currentAbortController.signal
            });

            if (!response.ok) {
                removeThinkingIndicator();
                var errorData;
                try {
                    errorData = await response.json();
                } catch (parseErr) {
                    throw new Error('HTTP ' + response.status + ' ' + response.statusText);
                }
                throw new Error(errorData.error && errorData.error.message ? errorData.error.message : 'API request failed (HTTP ' + response.status + ')');
            }

            removeThinkingIndicator();

            var msgContentElement = appendMessageToUI('bot', '');
            var fullResponse = '';
            var fullReasoning = '';
            
            // Setup reader for stream
            var reader = response.body.getReader();
            var decoder = new TextDecoder('utf-8');
            var buffer = '';

            while (true) {
                var { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                var lines = buffer.split('\n');
                
                // Keep the last incomplete line in buffer
                buffer = lines.pop();

                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (line.startsWith('data: ')) {
                        var dataStr = line.substring(6);
                        if (dataStr === '[DONE]') continue;

                        try {
                            var dataObj = JSON.parse(dataStr);
                            if (dataObj.choices && dataObj.choices[0] && dataObj.choices[0].delta) {
                                var delta = dataObj.choices[0].delta;
                                var updated = false;

                                if (delta.reasoning) {
                                    fullReasoning += delta.reasoning;
                                    updated = true;
                                }
                                if (delta.content !== undefined && delta.content !== null && delta.content !== '') {
                                    fullResponse += delta.content;
                                    updated = true;
                                }

                                if (updated || (!fullResponse && !fullReasoning)) {
                                    // Render markdown with streaming cursor
                                    var displayHTML = '';
                                    if (fullReasoning) {
                                        // Keep details open while streaming
                                        displayHTML += '<details class="reasoning-details" open><summary>กระบวนการคิดของ AI</summary><div class="reasoning-content">' + marked.parse(fullReasoning) + '</div></details>';
                                    }
                                    if (fullResponse) {
                                        displayHTML += marked.parse(fullResponse);
                                    }
                                    
                                    var cleanHTML = DOMPurify.sanitize(displayHTML);
                                    msgContentElement.innerHTML = cleanHTML + '<span class="streaming-cursor"></span>';
                                    scrollToBottom();
                                }
                            }
                        } catch (e) {
                            console.warn('Error parsing stream chunk:', e, dataStr);
                        }
                    }
                }
            }

            // Remove cursor and highlight code blocks when done
            var finalDisplayHTML = '';
            if (fullReasoning) {
                finalDisplayHTML += '<details class="reasoning-details"><summary>กระบวนการคิดของ AI</summary><div class="reasoning-content">' + marked.parse(fullReasoning) + '</div></details>';
            }
            if (fullResponse) {
                finalDisplayHTML += marked.parse(fullResponse);
            }
            var finalHTML = DOMPurify.sanitize(finalDisplayHTML);
            msgContentElement.innerHTML = finalHTML;
            msgContentElement.querySelectorAll('pre code').forEach(function(block) {
                hljs.highlightElement(block);
            });

            // Save final bot response
            currentSession.messages.push({ role: 'bot', content: fullResponse });
            saveSessions();

        } catch (error) {
            console.error('Error calling OpenRouter:', error);
            removeThinkingIndicator();
            if (error.name === 'AbortError') {
                appendMessageToUI('bot', '**⚠️ หยุดการสร้างคำตอบแล้ว**');
            } else {
                appendMessageToUI('bot', '**❌ Error:** เกิดข้อผิดพลาดในการเชื่อมต่อ\n\n`' + error.message + '`\n\nกรุณาเปลี่ยนโมเดล หรือตรวจสอบการเชื่อมต่ออินเทอร์เน็ตของคุณ');
            }
        } finally {
            isGenerating = false;
            currentAbortController = null;
            updateSendButton();
            
            // Hide stop button
            stopBtn.classList.remove('active');
            setTimeout(function() { stopBtn.classList.add('hidden'); }, 300);
        }
    }

    // Start app when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
