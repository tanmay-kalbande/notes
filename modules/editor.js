// =============================================================================
// modules/editor.js — Rich Text Editor, Formatting, Shortcuts, Paste Handling
// =============================================================================

import {
    markdownToHtml,
    looksLikeMarkdown,
    sanitizeHtml,
    normalizeStoredContent,
    formatTimestamp
} from './markdown.js';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const WORDS_PER_MINUTE = 200;

// -----------------------------------------------------------------------------
// Module State
// -----------------------------------------------------------------------------

let noteTitleInput = null;
let noteBodyEditable = null;
let editorToolbar = null;
let wordCountEl = null;
let charCountEl = null;
let readingTimeEl = null;
let lastModifiedEl = null;
let fontSizeValEl = null;

let currentFontSize = parseInt(localStorage.getItem('noteFontSize'), 10) || 16;
let isApplyingFormat = false;

// Callbacks provided by app.js
let onContentChange = () => {};
let getMainViewState = () => 'placeholder';

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

export function initEditor(config) {
    noteTitleInput = config.noteTitleInput;
    noteBodyEditable = config.noteBodyEditable;
    editorToolbar = config.editorToolbar;
    wordCountEl = config.wordCountEl;
    charCountEl = config.charCountEl;
    readingTimeEl = config.readingTimeEl;
    lastModifiedEl = config.lastModifiedEl;
    fontSizeValEl = config.fontSizeValEl;
    onContentChange = config.onContentChange || (() => {});
    getMainViewState = config.getMainViewState || (() => 'placeholder');

    applyFontSize();

    // Font size buttons
    const fontDecBtn = document.getElementById('font-decrease-btn');
    const fontIncBtn = document.getElementById('font-increase-btn');

    if (fontDecBtn) {
        fontDecBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (currentFontSize > 10) {
                currentFontSize--;
                applyFontSize();
            }
        });
    }
    if (fontIncBtn) {
        fontIncBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (currentFontSize < 36) {
                currentFontSize++;
                applyFontSize();
            }
        });
    }
}

function applyFontSize() {
    if (noteBodyEditable) noteBodyEditable.style.fontSize = `${currentFontSize}px`;
    if (fontSizeValEl) fontSizeValEl.textContent = `${currentFontSize}px`;
    localStorage.setItem('noteFontSize', currentFontSize);
}

// -----------------------------------------------------------------------------
// Editor Content Accessors
// -----------------------------------------------------------------------------

export function loadNoteIntoEditor(note) {
    if (!note) return;
    noteTitleInput.value = note.title;
    noteBodyEditable.innerHTML = normalizeStoredContent(note.content);
    updateStatusBar();
    updateToolbarStates();
}

export function getEditorTitle() {
    return noteTitleInput ? noteTitleInput.value : '';
}

export function getEditorPlainText() {
    return (noteBodyEditable.innerText || '').replace(/\u00a0/g, ' ');
}

/**
 * Gets editor content ready for storage.
 * Smart auto-formatting: converts raw markdown text to HTML if the editor
 * contains only plain text with markdown patterns. This is programmatic —
 * NO AI is used. Only triggers on save/blur, never during active typing.
 */
export function getEditorContentForStorage() {
    applyMarkdownFormattingIfNeeded();
    return sanitizeHtml(noteBodyEditable.innerHTML.trim());
}

export function resetEditorFields() {
    if (noteTitleInput) noteTitleInput.value = '';
    if (noteBodyEditable) noteBodyEditable.innerHTML = '';
    updateStatusBar();
    clearToolbarStates();
}

// -----------------------------------------------------------------------------
// Formatting Commands
// -----------------------------------------------------------------------------

/**
 * Applies a formatting command to the current selection.
 * Uses document.execCommand which, while deprecated, remains the only
 * reliable cross-browser API for contenteditable formatting.
 * There is no standard replacement as of 2026.
 */
export function applyFormat(command, value) {
    if (!noteBodyEditable.contains(document.activeElement)) {
        noteBodyEditable.focus();
    }
    const cmdValue = (command === 'formatBlock' && value) ? `<${value}>` : (value || null);
    document.execCommand(command, false, cmdValue);
    updateToolbarStates();
}

export function handleToolbarClick(e) {
    let target = e.target;
    while (target && target !== editorToolbar && !target.classList.contains('toolbar-btn')) {
        target = target.parentElement;
    }

    if (target && target.classList.contains('format-btn')) {
        const command = target.dataset.command;
        if (command) {
            if (!noteBodyEditable.contains(document.activeElement)) {
                noteBodyEditable.focus();
                setTimeout(() => {
                    applyFormat(command, target.dataset.value);
                    onContentChange();
                }, 50);
            } else {
                applyFormat(command, target.dataset.value);
                onContentChange();
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Keyboard Shortcuts
// -----------------------------------------------------------------------------

export function handleFormattingKeys(e) {
    if (e.ctrlKey || e.metaKey) {
        let command = null;
        switch (e.key.toLowerCase()) {
            case 'b': command = 'bold'; break;
            case 'i': command = 'italic'; break;
            case 'u': command = 'underline'; break;
        }
        if (command) {
            e.preventDefault();
            document.execCommand(command, false, null);
            onContentChange();
            updateToolbarStates();
        }
    }
}

/**
 * Live markdown shortcuts — converts markdown syntax to rich formatting
 * when the user presses Space after typing a pattern at the start of a line.
 * e.g., "## " → H2, "- " → bullet list, "> " → blockquote
 */
export function handleMarkdownShortcuts(e) {
    if (e.key !== ' ' && e.key !== 'Spacebar') return;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const container = range.startContainer;

    if (container.nodeType !== Node.TEXT_NODE) return;

    const text = container.textContent;
    const offset = range.startOffset;
    const before = text.substring(0, offset);

    // Heading: # to ######
    const headingMatch = before.match(/^(#{1,6})$/);
    if (headingMatch) {
        e.preventDefault();
        const level = headingMatch[1].length;
        range.setStart(container, offset - level);
        range.setEnd(container, offset);
        range.deleteContents();
        document.execCommand('formatBlock', false, `H${level}`);
        onContentChange();
        return;
    }

    // Unordered list: -, *, +
    const ulMatch = before.match(/^([-*+])$/);
    if (ulMatch) {
        e.preventDefault();
        range.setStart(container, offset - 1);
        range.setEnd(container, offset);
        range.deleteContents();
        document.execCommand('insertUnorderedList', false, null);
        onContentChange();
        return;
    }

    // Ordered list: 1.
    const olMatch = before.match(/^(1\.)$/);
    if (olMatch) {
        e.preventDefault();
        range.setStart(container, offset - 2);
        range.setEnd(container, offset);
        range.deleteContents();
        document.execCommand('insertOrderedList', false, null);
        onContentChange();
        return;
    }

    // Blockquote: >
    const bqMatch = before.match(/^([>])$/);
    if (bqMatch) {
        e.preventDefault();
        range.setStart(container, offset - 1);
        range.setEnd(container, offset);
        range.deleteContents();
        document.execCommand('formatBlock', false, 'BLOCKQUOTE');
        onContentChange();
        return;
    }

    // Horizontal rule: ---
    const hrMatch = before.match(/^(-{3,})$/);
    if (hrMatch) {
        e.preventDefault();
        range.setStart(container, offset - hrMatch[1].length);
        range.setEnd(container, offset);
        range.deleteContents();
        document.execCommand('insertHorizontalRule', false, null);
        onContentChange();
        return;
    }
}

// -----------------------------------------------------------------------------
// Paste Handling
// -----------------------------------------------------------------------------

export function handlePaste(e) {
    e.preventDefault();
    const text = (e.originalEvent || e).clipboardData?.getData('text/plain');
    if (!text) return;

    if (looksLikeMarkdown(text)) {
        insertHtmlAtSelection(markdownToHtml(text));
    } else {
        insertPlainTextAtSelection(text);
    }

    onContentChange();
}

function insertHtmlAtSelection(html) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const template = document.createElement('template');
    template.innerHTML = sanitizeHtml(html);
    const fragment = template.content;
    const lastNode = fragment.lastChild;

    range.insertNode(fragment);
    if (lastNode) moveSelectionAfterNode(selection, lastNode);
}

function insertPlainTextAtSelection(text) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const lines = text.split(/\r?\n/);
    const range = selection.getRangeAt(0);
    range.deleteContents();

    const fragment = document.createDocumentFragment();
    let lastNode = null;

    lines.forEach((line, index) => {
        if (line.length > 0) {
            const textNode = document.createTextNode(line);
            fragment.appendChild(textNode);
            lastNode = textNode;
        }
        if (index < lines.length - 1) {
            const br = document.createElement('br');
            fragment.appendChild(br);
            lastNode = br;
        }
    });

    range.insertNode(fragment);
    if (lastNode) moveSelectionAfterNode(selection, lastNode);
}

function moveSelectionAfterNode(selection, node) {
    if (!node) return;
    const newRange = document.createRange();
    newRange.setStartAfter(node);
    newRange.setEndAfter(node);
    selection.removeAllRanges();
    selection.addRange(newRange);
}

// -----------------------------------------------------------------------------
// Smart Auto-Formatting (Programmatic — NO AI)
// Converts raw markdown text to rich HTML only on blur/save, not during typing.
// This ensures the user is never interrupted while typing.
// -----------------------------------------------------------------------------

function editorContainsMeaningfulHtml() {
    return Boolean(noteBodyEditable.querySelector(
        'a,b,blockquote,code,em,h1,h2,h3,h4,h5,h6,hr,i,li,ol,pre,s,strike,strong,u,ul,table,img,input'
    ));
}

function applyMarkdownFormattingIfNeeded() {
    if (isApplyingFormat) return;
    if (getMainViewState() !== 'editor') return;

    const plainText = getEditorPlainText().trim();
    if (!plainText || !looksLikeMarkdown(plainText)) return;

    // Don't re-format if already has rich HTML elements
    if (editorContainsMeaningfulHtml()) return;

    const html = markdownToHtml(plainText);
    if (!html || html === sanitizeHtml(noteBodyEditable.innerHTML.trim())) return;

    const hadFocus = document.activeElement === noteBodyEditable;
    isApplyingFormat = true;
    noteBodyEditable.innerHTML = html;
    isApplyingFormat = false;

    if (hadFocus) placeCaretAtEnd(noteBodyEditable);
    updateStatusBar();
    updateToolbarStates();
}

function placeCaretAtEnd(element) {
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}

// -----------------------------------------------------------------------------
// Blur Handler
// -----------------------------------------------------------------------------

export function handleEditorBlur() {
    clearToolbarStates();
    // On blur, apply markdown formatting if the content is raw markdown text
    applyMarkdownFormattingIfNeeded();
}

// -----------------------------------------------------------------------------
// Status Bar
// -----------------------------------------------------------------------------

export function updateStatusBar() {
    requestAnimationFrame(() => {
        if (getMainViewState() !== 'editor') {
            if (wordCountEl) wordCountEl.innerHTML = '<i class="fas fa-text-width"></i> 0 words';
            if (charCountEl) charCountEl.innerHTML = '<i class="fas fa-pen-nib"></i> 0 characters';
            if (readingTimeEl) readingTimeEl.innerHTML = '<i class="fas fa-clock"></i> 0 min read';
            return;
        }
        const content = noteBodyEditable.innerText || '';
        const words = content.trim().split(/\s+/).filter(Boolean);
        const wordCount = words.length;
        const charCount = content.length;
        const minutes = wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));

        if (wordCountEl) wordCountEl.innerHTML = `<i class="fas fa-text-width"></i> ${wordCount} words`;
        if (charCountEl) charCountEl.innerHTML = `<i class="fas fa-pen-nib"></i> ${charCount} characters`;
        if (readingTimeEl) readingTimeEl.innerHTML = `<i class="fas fa-clock"></i> ${minutes} min read`;
    });
}

export function updateLastModified(timestamp) {
    if (lastModifiedEl) {
        lastModifiedEl.textContent = timestamp
            ? `Modified: ${formatTimestamp(timestamp, true)}`
            : '';
    }
}

// -----------------------------------------------------------------------------
// Toolbar State Management
// -----------------------------------------------------------------------------

export function updateToolbarStates() {
    if (getMainViewState() !== 'editor') {
        clearToolbarStates();
        return;
    }
    requestAnimationFrame(() => {
        if (!editorToolbar) return;
        editorToolbar.querySelectorAll('.format-btn').forEach(btn => {
            const command = btn.dataset.command;
            let isActive = false;
            if (command) {
                try {
                    if (command === 'formatBlock' && btn.dataset.value === 'blockquote') {
                        isActive = isSelectionInTag('BLOCKQUOTE');
                    } else {
                        isActive = document.queryCommandState(command);
                    }
                } catch {
                    // Ignore errors from unsupported commands
                }
            }
            btn.classList.toggle('active', isActive);
        });
    });
}

function isSelectionInTag(tagName) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    let node = selection.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== noteBodyEditable) {
        if (node.nodeName === tagName) return true;
        node = node.parentNode;
    }
    return false;
}

export function clearToolbarStates() {
    if (editorToolbar) {
        editorToolbar.querySelectorAll('.toolbar-btn.active').forEach(btn =>
            btn.classList.remove('active')
        );
    }
}

// -----------------------------------------------------------------------------
// Public getters
// -----------------------------------------------------------------------------

export function getIsApplyingFormat() {
    return isApplyingFormat;
}
