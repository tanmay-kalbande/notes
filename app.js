// =============================================================================
// app.js — Main Application Orchestrator
// =============================================================================

import {
    loadNotesFromStorage,
    saveNotesToStorage,
    createNewNote,
    updateNoteInArray,
    exportAllNotesAsJson,
    exportNoteAsText,
    importNotesFromFile
} from './modules/store.js';

import { performSearch } from './modules/search.js';

import {
    initEditor,
    loadNoteIntoEditor,
    getEditorTitle,
    getEditorContentForStorage,
    getEditorPlainText,
    getIsApplyingFormat,
    resetEditorFields,
    handleToolbarClick,
    handleFormattingKeys,
    handleMarkdownShortcuts,
    handlePaste,
    handleEditorBlur,
    updateStatusBar,
    updateLastModified,
    updateToolbarStates,
    clearToolbarStates
} from './modules/editor.js';

import {
    initUI,
    getMainViewState,
    setMainViewState,
    renderNotesList,
    highlightActiveNoteItem,
    renderSearchResultsInMainView,
    showNotification,
    toggleSidebar,
    loadSidebarWidth
} from './modules/ui.js';

import { initAiEnhancer } from './modules/ai.js';

// =============================================================================
// Application State
// =============================================================================

let notes = [];
let activeNoteIndex = null;
let autoSaveTimeout = null;
let searchTimeout = null;

const AUTO_SAVE_DELAY = 1500;

// =============================================================================
// DOM References
// =============================================================================

const dom = {
    // Editor
    noteTitleInput: document.querySelector('.note-title'),
    noteBodyEditable: document.querySelector('.note-body'),
    editorToolbar: document.querySelector('.editor-toolbar'),
    wordCountEl: document.querySelector('.word-count'),
    charCountEl: document.querySelector('.char-count'),
    readingTimeEl: document.querySelector('.reading-time'),
    lastModifiedEl: document.querySelector('.last-modified'),
    fontSizeValEl: document.getElementById('font-size-val'),

    // Layout
    sidebar: document.querySelector('.sidebar'),
    overlay: document.querySelector('.overlay'),
    notesListEl: document.querySelector('.notes-list'),
    notesCountEl: document.querySelector('.notes-count'),
    editorPlaceholder: document.querySelector('.editor-placeholder'),
    editorWrapper: document.querySelector('.editor-wrapper'),
    searchResultsView: document.querySelector('.search-results-view'),
    searchResultsHeaderQuery: document.querySelector('.search-query-display'),
    searchResultsListContainer: document.querySelector('.search-results-list-container'),
    searchNoResultsMsg: document.querySelector('.search-no-results'),

    // Controls
    newNoteBtn: document.querySelector('.new-note-btn'),
    deleteNoteBtn: document.querySelector('.delete-note-btn'),
    themeSwitchBtn: document.querySelector('.titlebar-theme-btn'),
    sidebarToggleBtn: document.querySelector('.sidebar-toggle'),
    resizeHandle: document.querySelector('.resize-handle'),
    searchInput: document.querySelector('.search-input'),
    exportAllBtn: document.querySelector('.export-all-btn'),
    importBtn: document.querySelector('.import-btn'),
    importFileInput: document.querySelector('.import-file-input'),
    exportNoteBtn: document.querySelector('.export-note-btn'),
    notification: document.querySelector('.notification'),
    notificationMessage: document.querySelector('.notification-message'),
    notificationIcon: document.querySelector('.notification-icon i'),
};

// =============================================================================
// Initialize Application
// =============================================================================

function initializeApp() {
    // Load data
    notes = loadNotesFromStorage();

    // Initialize modules with DOM refs and callbacks
    initEditor({
        noteTitleInput: dom.noteTitleInput,
        noteBodyEditable: dom.noteBodyEditable,
        editorToolbar: dom.editorToolbar,
        wordCountEl: dom.wordCountEl,
        charCountEl: dom.charCountEl,
        readingTimeEl: dom.readingTimeEl,
        lastModifiedEl: dom.lastModifiedEl,
        fontSizeValEl: dom.fontSizeValEl,
        onContentChange: handleEditorInput,
        getMainViewState: getMainViewState
    });

    initUI({
        sidebar: dom.sidebar,
        overlay: dom.overlay,
        notesListEl: dom.notesListEl,
        notesCountEl: dom.notesCountEl,
        editorPlaceholder: dom.editorPlaceholder,
        editorWrapper: dom.editorWrapper,
        searchResultsView: dom.searchResultsView,
        searchResultsHeaderQuery: dom.searchResultsHeaderQuery,
        searchResultsListContainer: dom.searchResultsListContainer,
        searchNoResultsMsg: dom.searchNoResultsMsg,
        themeSwitchBtn: dom.themeSwitchBtn,
        resizeHandle: dom.resizeHandle,
        sidebarToggleBtn: dom.sidebarToggleBtn,
        notification: dom.notification,
        notificationMessage: dom.notificationMessage,
        notificationIcon: dom.notificationIcon,
        onNoteClick: handleNoteClick,
        onSearchResultClick: handleSearchResultClick
    });

    initAiEnhancer({
        getEditorPlainText: getEditorPlainText,
        getMainViewState: getMainViewState,
        getActiveNoteIndex: () => activeNoteIndex,
        onApplyEnhancement: applyAiEnhancement,
        showNotification: showNotification
    });

    // Render initial state
    renderNotesList(notes, notes, activeNoteIndex, '');
    setMainViewState('placeholder');

    // Bind event listeners
    addEventListeners();

    // Register service worker
    registerServiceWorker();
}

// =============================================================================
// Event Listeners
// =============================================================================

function addEventListeners() {
    // Create / Delete
    dom.newNoteBtn.addEventListener('click', createNote);
    dom.deleteNoteBtn.addEventListener('click', deleteNote);

    // Editor events
    dom.noteTitleInput.addEventListener('input', startAutoSaveTimer);
    dom.noteBodyEditable.addEventListener('input', handleEditorInput);
    dom.noteBodyEditable.addEventListener('paste', handlePaste);
    dom.noteBodyEditable.addEventListener('focus', updateToolbarStates);
    dom.noteBodyEditable.addEventListener('blur', handleBlur);
    dom.noteBodyEditable.addEventListener('keyup', updateToolbarStates);
    dom.noteBodyEditable.addEventListener('keydown', handleFormattingKeys);
    dom.noteBodyEditable.addEventListener('keydown', handleMarkdownShortcuts);
    dom.editorToolbar.addEventListener('click', handleToolbarClick);

    // Selection changes
    document.addEventListener('selectionchange', handleSelectionChange);

    // Search
    dom.searchInput.addEventListener('input', handleSearchInput);
    dom.searchInput.addEventListener('search', () => {
        if (!dom.searchInput.value) handleSearchInput();
    });

    // Import / Export
    dom.exportAllBtn.addEventListener('click', handleExportAll);
    dom.importBtn.addEventListener('click', () => dom.importFileInput.click());
    dom.importFileInput.addEventListener('change', handleImport);
    dom.exportNoteBtn.addEventListener('click', handleExportCurrentNote);

    // Window events
    window.addEventListener('resize', loadSidebarWidth);
    window.addEventListener('beforeunload', flushPendingNoteSave);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushPendingNoteSave();
    });
}

// =============================================================================
// Note Actions
// =============================================================================

function createNote() {
    // Save current note before creating new one
    if (activeNoteIndex !== null) {
        clearTimeout(autoSaveTimeout);
        saveCurrentNote(true);
    }

    const newNote = createNewNote();
    notes.unshift(newNote);
    saveNotesToStorage(notes);

    // Clear search if active
    if (getMainViewState() === 'search' || dom.searchInput.value.trim()) {
        dom.searchInput.value = '';
    }

    renderNotesList(notes, notes, 0, '');
    loadNote(0);
    dom.noteTitleInput.focus();
}

function loadNote(index) {
    if (index < 0 || index >= notes.length) {
        resetEditor();
        return;
    }

    // Save previous note if switching
    if (activeNoteIndex !== null && activeNoteIndex !== index) {
        clearTimeout(autoSaveTimeout);
        saveCurrentNote(true);
    }

    activeNoteIndex = index;
    const note = notes[index];

    loadNoteIntoEditor(note);
    setMainViewState('editor', activeNoteIndex, notes.length);
    updateLastModified(note.timestamp);
    highlightActiveNoteItem(activeNoteIndex);

    // Close sidebar on mobile after selecting a note
    if (window.innerWidth <= 768 && dom.sidebar.classList.contains('active')) {
        toggleSidebar();
    }
}

function saveCurrentNote(forceMarkdown = false) {
    if (activeNoteIndex === null || activeNoteIndex >= notes.length) return;

    const newTitle = getEditorTitle();
    const newContent = getEditorContentForStorage();

    const result = updateNoteInArray(notes, activeNoteIndex, newTitle, newContent);
    if (result) {
        notes = result.notes;
        activeNoteIndex = result.newActiveIndex;
        renderNotesList(notes, notes, activeNoteIndex, dom.searchInput.value.trim());
        updateLastModified(notes[activeNoteIndex].timestamp);
    }
}

function deleteNote() {
    if (activeNoteIndex === null || activeNoteIndex >= notes.length) return;

    const noteToDelete = notes[activeNoteIndex];
    const noteTitle = noteToDelete.title || 'Untitled';

    if (confirm(`Are you sure you want to delete "${noteTitle}"? This cannot be undone.`)) {
        const wasSearching = getMainViewState() === 'search';

        notes.splice(activeNoteIndex, 1);
        saveNotesToStorage(notes);
        activeNoteIndex = null;

        if (wasSearching) {
            handleSearchInput();
        } else {
            renderNotesList(notes, notes, activeNoteIndex, '');
            resetEditor();
        }

        showNotification(`Note "${noteTitle}" deleted.`);
    }
}

function resetEditor() {
    activeNoteIndex = null;
    resetEditorFields();
    setMainViewState('placeholder');
    updateLastModified(null);
    highlightActiveNoteItem(null);
}

// =============================================================================
// Editor Input Handling
// =============================================================================

function handleEditorInput() {
    if (getIsApplyingFormat()) return;
    startAutoSaveTimer();
    updateStatusBar();
    if (document.activeElement === dom.noteBodyEditable) {
        updateToolbarStates();
    }
}

function handleSelectionChange() {
    if (document.activeElement === dom.noteBodyEditable) {
        updateToolbarStates();
    }
}

function handleBlur() {
    handleEditorBlur();
    // Save on blur
    if (getMainViewState() === 'editor') {
        saveCurrentNote(true);
    }
}

function startAutoSaveTimer() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        if (getMainViewState() === 'editor') {
            saveCurrentNote();
        }
    }, AUTO_SAVE_DELAY);
}

function flushPendingNoteSave() {
    clearTimeout(autoSaveTimeout);
    if (getMainViewState() === 'editor') {
        saveCurrentNote(true);
    }
}

// =============================================================================
// Search
// =============================================================================

function handleSearchInput() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        const query = dom.searchInput.value.trim();

        if (!query) {
            renderNotesList(notes, notes, activeNoteIndex, '');
            if (activeNoteIndex !== null) {
                setMainViewState('editor', activeNoteIndex, notes.length);
                highlightActiveNoteItem(activeNoteIndex);
            } else {
                setMainViewState('placeholder');
            }
            return;
        }

        const searchResults = performSearch(notes, query);
        renderNotesList(searchResults, notes, activeNoteIndex, query);
        renderSearchResultsInMainView(searchResults, query, notes);
        setMainViewState('search');
    }, 300);
}

function handleNoteClick(originalIndex) {
    clearTimeout(autoSaveTimeout);
    saveCurrentNote(true);
    loadNote(originalIndex);
}

function handleSearchResultClick(originalIndex) {
    clearTimeout(autoSaveTimeout);
    // Fix: Load the note AND switch to editor view (original bug: stayed in search view)
    loadNote(originalIndex);
}

// =============================================================================
// Import / Export
// =============================================================================

function handleExportAll() {
    if (notes.length === 0) {
        showNotification('No notes to export.', true);
        return;
    }
    if (exportAllNotesAsJson(notes)) {
        showNotification('All notes exported successfully!');
    } else {
        showNotification('Failed to export notes.', true);
    }
}

function handleExportCurrentNote() {
    if (getMainViewState() !== 'editor' || activeNoteIndex === null) {
        showNotification('No active note selected to export.', true);
        return;
    }
    const note = notes[activeNoteIndex];
    const title = note.title || 'Untitled';
    if (exportNoteAsText(note)) {
        showNotification(`Note "${title}" exported as text.`);
    } else {
        showNotification('Failed to export current note.', true);
    }
}

async function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const result = await importNotesFromFile(file, notes);
        notes = result.notes;
        saveNotesToStorage(notes);

        // Clear search and reset UI
        if (getMainViewState() === 'search' || dom.searchInput.value.trim()) {
            dom.searchInput.value = '';
        }
        renderNotesList(notes, notes, null, '');
        resetEditor();

        // Build feedback message
        let message = `${result.stats.imported} new note(s) imported.`;
        if (result.stats.skipped > 0) message += ` ${result.stats.skipped} existing notes skipped.`;
        if (result.stats.invalid > 0) message += ` ${result.stats.invalid} invalid items ignored.`;
        showNotification(message);
    } catch (error) {
        showNotification(`Import failed: ${error.message}`, true);
    } finally {
        dom.importFileInput.value = '';
    }
}

// =============================================================================
// AI Enhancement
// =============================================================================

function applyAiEnhancement(enhancedHtml) {
    if (!enhancedHtml || activeNoteIndex === null) return;
    dom.noteBodyEditable.innerHTML = enhancedHtml;
    handleEditorInput();
}

// =============================================================================
// Service Worker
// =============================================================================

function registerServiceWorker() {
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    if (!('serviceWorker' in navigator) || !(window.isSecureContext || isLocalhost)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .catch(error => console.warn('Service worker registration failed:', error));
    });
}

// =============================================================================
// Start the Application
// =============================================================================

initializeApp();
