// =============================================================================
// modules/ui.js — Sidebar, Theme, Resize, Notifications, Rendering
// =============================================================================

import { escapeHtml, getPlainTextFromHtml, formatTimestamp } from './markdown.js';
import { highlightMatchesInText, getHighlightTerms, parseSearchQuery, escapeRegExp } from './search.js';

// -----------------------------------------------------------------------------
// Module State
// -----------------------------------------------------------------------------

let sidebar, overlay, notesListEl, notesCountEl;
let editorPlaceholder, editorWrapper, searchResultsView;
let searchResultsHeaderQuery, searchResultsListContainer, searchNoResultsMsg;
let themeSwitchBtn, resizeHandle;
let notification, notificationMessage, notificationIcon;
let sidebarToggleBtn;

let mainViewCurrentState = 'placeholder';
let isResizing = false;
let darkMode = localStorage.getItem('darkMode') !== 'false';

// Callbacks
let onNoteClick = () => {};
let onSearchResultClick = () => {};

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

export function initUI(config) {
    sidebar = config.sidebar;
    overlay = config.overlay;
    notesListEl = config.notesListEl;
    notesCountEl = config.notesCountEl;
    editorPlaceholder = config.editorPlaceholder;
    editorWrapper = config.editorWrapper;
    searchResultsView = config.searchResultsView;
    searchResultsHeaderQuery = config.searchResultsHeaderQuery;
    searchResultsListContainer = config.searchResultsListContainer;
    searchNoResultsMsg = config.searchNoResultsMsg;
    themeSwitchBtn = config.themeSwitchBtn;
    resizeHandle = config.resizeHandle;
    notification = config.notification;
    notificationMessage = config.notificationMessage;
    notificationIcon = config.notificationIcon;
    sidebarToggleBtn = config.sidebarToggleBtn;
    onNoteClick = config.onNoteClick || (() => {});
    onSearchResultClick = config.onSearchResultClick || (() => {});

    // Sidebar toggle
    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleSidebar);
    if (overlay) overlay.addEventListener('click', toggleSidebar);

    // Theme
    if (themeSwitchBtn) themeSwitchBtn.addEventListener('click', toggleTheme);

    // Resize
    if (resizeHandle) resizeHandle.addEventListener('mousedown', startResize);

    // Apply initial state
    applyTheme();
    loadSidebarWidth();
}

// -----------------------------------------------------------------------------
// Main View State
// -----------------------------------------------------------------------------

export function getMainViewState() {
    return mainViewCurrentState;
}

export function setMainViewState(state, activeNoteIndex = null, notesLength = 0) {
    mainViewCurrentState = state;

    // Hide all views first
    editorPlaceholder.style.display = 'none';
    editorWrapper.style.display = 'none';
    searchResultsView.style.display = 'none';

    switch (state) {
        case 'search':
            searchResultsView.style.display = 'flex';
            break;
        case 'editor':
            if (activeNoteIndex !== null && activeNoteIndex < notesLength) {
                editorWrapper.style.display = 'flex';
            } else {
                editorPlaceholder.style.display = 'flex';
                mainViewCurrentState = 'placeholder';
            }
            break;
        case 'placeholder':
        default:
            editorPlaceholder.style.display = 'flex';
            break;
    }
}

// -----------------------------------------------------------------------------
// Notes List Rendering
// -----------------------------------------------------------------------------

export function renderNotesList(notesToRender, allNotes, activeNoteIndex, searchQuery) {
    notesListEl.innerHTML = '';

    notesToRender.forEach(note => {
        const originalIndex = allNotes.findIndex(n => n.id === note.id);
        if (originalIndex === -1) return;

        const noteItem = document.createElement('li');
        noteItem.classList.add('note-item');
        noteItem.setAttribute('data-index', originalIndex);

        const previewText = getPlainTextFromHtml(note.content);
        const query = searchQuery || '';
        const terms = query ? getHighlightTerms(query) : [];
        const title = highlightMatchesInText(note.title || 'Untitled', terms);
        const preview = highlightMatchesInText(previewText.substring(0, 100), terms);

        noteItem.innerHTML = `
            <div class="note-item-title">${title}</div>
            <div class="note-item-preview">${preview || '<span style="color: var(--text-tertiary);">Empty Note</span>'}</div>
            <div class="timestamp">${escapeHtml(formatTimestamp(note.timestamp))}</div>
        `;

        noteItem.addEventListener('click', () => {
            if (originalIndex === activeNoteIndex) return;
            onNoteClick(originalIndex);
        });

        notesListEl.appendChild(noteItem);
    });

    updateNotesCount(notesToRender.length, allNotes.length, !!searchQuery);
    highlightActiveNoteItem(activeNoteIndex);
}

export function highlightActiveNoteItem(activeNoteIndex) {
    document.querySelectorAll('.note-item').forEach(item => {
        const itemIndex = parseInt(item.getAttribute('data-index'), 10);
        item.classList.toggle('active', itemIndex === activeNoteIndex);
    });
}

function updateNotesCount(shownCount, totalCount, hasQuery) {
    if (!hasQuery || shownCount === totalCount) {
        notesCountEl.textContent = `${totalCount} note${totalCount !== 1 ? 's' : ''}`;
    } else {
        notesCountEl.textContent = `Found ${shownCount} of ${totalCount}`;
    }
}

// -----------------------------------------------------------------------------
// Search Results Rendering (Main Area)
// -----------------------------------------------------------------------------

export function renderSearchResultsInMainView(results, query, allNotes) {
    searchResultsHeaderQuery.textContent = query;
    searchResultsListContainer.innerHTML = '';

    if (results.length === 0) {
        searchNoResultsMsg.style.display = 'block';
        searchResultsListContainer.style.display = 'none';
    } else {
        searchNoResultsMsg.style.display = 'none';
        searchResultsListContainer.style.display = 'block';

        results.forEach(note => {
            const originalIndex = allNotes.findIndex(n => n.id === note.id);
            if (originalIndex === -1) return;

            const item = document.createElement('div');
            item.classList.add('search-result-item');
            item.setAttribute('data-index', originalIndex);

            const contentText = getPlainTextFromHtml(note.content);
            let snippetText = contentText.substring(0, 250);

            const terms = parseSearchQuery(query);
            const positiveTerms = terms.filter(t => t.type !== 'excluded' && t.text);
            const positiveTermText = positiveTerms.map(t => t.text).sort((a, b) => b.length - a.length);

            // Find first match to create a context snippet
            let firstMatchIndex = -1;
            if (positiveTerms.length > 0) {
                for (const term of positiveTerms) {
                    try {
                        const pattern = term.type === 'phrase'
                            ? escapeRegExp(term.text)
                            : `\\b${escapeRegExp(term.text)}`;
                        const regex = new RegExp(pattern, 'i');
                        const match = contentText.match(regex);
                        if (match && match.index !== undefined) {
                            firstMatchIndex = match.index;
                            break;
                        }
                    } catch { /* ignore */ }
                }
            }

            if (firstMatchIndex !== -1) {
                const start = Math.max(0, firstMatchIndex - 80);
                const end = Math.min(contentText.length, firstMatchIndex + 170);
                snippetText = (start > 0 ? '... ' : '') +
                    contentText.substring(start, end) +
                    (end < contentText.length ? ' ...' : '');
            }

            const titleHtml = highlightMatchesInText(note.title || 'Untitled', positiveTermText);
            const snippetHtml = highlightMatchesInText(snippetText, positiveTermText);

            item.innerHTML = `
                <div class="search-result-note-title">${titleHtml}</div>
                <div class="search-result-snippet">${snippetHtml || '<span style="color: var(--text-tertiary);">Empty Note</span>'}</div>
            `;

            item.addEventListener('click', () => {
                onSearchResultClick(originalIndex);
            });

            searchResultsListContainer.appendChild(item);
        });
    }
}

// -----------------------------------------------------------------------------
// Notifications
// -----------------------------------------------------------------------------

export function showNotification(message, isError = false) {
    if (!notification) return;

    notificationMessage.textContent = message;
    notificationIcon.className = isError
        ? 'fas fa-exclamation-circle error-icon'
        : 'fas fa-check-circle success-icon';
    notification.classList.toggle('error', isError);

    clearTimeout(notification._timerId);
    notification.classList.remove('show');
    void notification.offsetWidth; // Force reflow to restart animation

    notification.classList.add('show');
    notification._timerId = setTimeout(() => {
        notification.classList.remove('show');
    }, 3500);
}

// -----------------------------------------------------------------------------
// Theme
// -----------------------------------------------------------------------------

export function applyTheme() {
    document.body.classList.toggle('light-mode', !darkMode);
    if (themeSwitchBtn) {
        themeSwitchBtn.innerHTML = darkMode ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        themeSwitchBtn.title = darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
}

export function toggleTheme() {
    darkMode = !darkMode;
    localStorage.setItem('darkMode', darkMode);
    applyTheme();
}

// -----------------------------------------------------------------------------
// Sidebar
// -----------------------------------------------------------------------------

export function toggleSidebar() {
    sidebar.classList.toggle('active');
    if (overlay) overlay.classList.toggle('active', sidebar.classList.contains('active'));
}

export function loadSidebarWidth() {
    if (window.innerWidth > 768) {
        const savedWidth = localStorage.getItem('sidebarWidth');
        if (savedWidth) {
            try {
                const numericWidth = parseInt(savedWidth, 10);
                const minW = parseInt(getComputedStyle(sidebar).minWidth, 10) || 220;
                const maxW = parseInt(getComputedStyle(sidebar).maxWidth, 10) || 600;
                if (!isNaN(numericWidth) && numericWidth > 0) {
                    sidebar.style.width = `${Math.max(minW, Math.min(numericWidth, maxW))}px`;
                } else {
                    sidebar.style.width = '';
                }
            } catch {
                sidebar.style.width = '';
            }
        } else {
            sidebar.style.width = '';
        }
    } else {
        sidebar.style.width = '';
    }
}

// -----------------------------------------------------------------------------
// Sidebar Resize
// -----------------------------------------------------------------------------

function startResize(e) {
    if (e.button !== 0) return;
    isResizing = true;
    resizeHandle.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize, { once: true });
}

function handleResize(e) {
    if (!isResizing) return;
    requestAnimationFrame(() => {
        const sidebarRect = sidebar.getBoundingClientRect();
        let newWidth = e.clientX - sidebarRect.left;
        const minW = parseInt(getComputedStyle(sidebar).minWidth, 10) || 220;
        const maxW = parseInt(getComputedStyle(sidebar).maxWidth, 10) || 600;
        newWidth = Math.max(minW, Math.min(newWidth, maxW));
        sidebar.style.width = `${newWidth}px`;
    });
}

function stopResize() {
    if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleResize);
        const finalWidth = sidebar.offsetWidth;
        if (finalWidth > 0) localStorage.setItem('sidebarWidth', finalWidth);
    }
}
