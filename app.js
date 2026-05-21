// =============================================================================
// app.js — Unified macOS Notes Engine & Orchestrator
// Handles note lifecycle, editing, advanced search, offline support, UI & AI.
// Structured modularly without ES module imports to run flawlessly via file://
// =============================================================================

// =============================================================================
// 1. Markdown & Sanitization Engine
// =============================================================================
const MarkdownEngine = (() => {
    const ALLOWED_CONTENT_TAGS = new Set([
        'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3',
        'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span',
        'strike', 'strong', 'u', 'ul', 'input',
        'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ]);

    const BLOCKED_CONTENT_TAGS = new Set([
        'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'
    ]);

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getSafeLinkHref(url) {
        const trimmed = (url || '').trim();
        if (!trimmed) return null;
        if (/^(#|\/|\.\/|\.\.\/)/.test(trimmed)) return trimmed;
        try {
            const parsed = new URL(trimmed, window.location.href);
            if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
                return trimmed;
            }
        } catch {
            return null;
        }
        return null;
    }

    function cleanContentNode(root) {
        Array.from(root.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) return;
            if (node.nodeType !== Node.ELEMENT_NODE) {
                node.remove();
                return;
            }

            const tag = node.tagName.toLowerCase();
            if (BLOCKED_CONTENT_TAGS.has(tag)) {
                node.remove();
                return;
            }

            cleanContentNode(node);

            if (!ALLOWED_CONTENT_TAGS.has(tag)) {
                node.replaceWith(...Array.from(node.childNodes));
                return;
            }

            // Clean attributes — only allow safe ones per tag
            Array.from(node.attributes).forEach(attr => {
                const name = attr.name.toLowerCase();
                const isLinkAttr = tag === 'a' && ['href', 'title', 'target', 'rel'].includes(name);
                const isCellAttr = ['th', 'td'].includes(tag) && name === 'align';
                const isImgAttr = tag === 'img' && ['src', 'alt', 'title', 'width', 'height'].includes(name);
                const isCheckboxAttr = tag === 'input' && ['type', 'checked', 'disabled'].includes(name);
                const isListClass = (tag === 'ul' || tag === 'li') && name === 'class';
                if (!isLinkAttr && !isCellAttr && !isImgAttr && !isCheckboxAttr && !isListClass) {
                    node.removeAttribute(attr.name);
                }
            });

            // Sanitize links
            if (tag === 'a') {
                const href = getSafeLinkHref(node.getAttribute('href'));
                if (href) {
                    node.setAttribute('href', href);
                    node.setAttribute('target', '_blank');
                    node.setAttribute('rel', 'noopener noreferrer');
                } else {
                    node.removeAttribute('href');
                    node.removeAttribute('target');
                    node.removeAttribute('rel');
                }
            }

            // Sanitize images
            if (tag === 'img') {
                const src = getSafeLinkHref(node.getAttribute('src'));
                if (!src) node.remove();
            }

            // Ensure checkboxes are always disabled (read-only in notes)
            if (tag === 'input') {
                if (node.getAttribute('type') !== 'checkbox') {
                    node.remove();
                } else {
                    node.setAttribute('disabled', '');
                }
            }
        });
    }

    function sanitizeHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = html || '';
        cleanContentNode(template.content);
        return template.innerHTML;
    }

    function getPlainTextFromHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = sanitizeHtml(html || '');
        return div.textContent || div.innerText || '';
    }

    function isProbablyHtml(value) {
        return /<\/?[a-z][\s\S]*>/i.test(value);
    }

    function isValidDateString(value) {
        if (!value) return false;
        const parsed = new Date(value);
        return !Number.isNaN(parsed.getTime());
    }

    function looksLikeMarkdown(text) {
        const t = String(text || '').trim();
        if (!t) return false;
        return (
            /(^|\n)#{1,6}\s+\S/.test(t) ||
            /(^|\n)\s*([-*+])\s+\S/.test(t) ||
            /(^|\n)\s*\d+[.)]\s+\S/.test(t) ||
            /(^|\n)>\s+\S/.test(t) ||
            /(^|\n)```/.test(t) ||
            /(^|\n)\s*([-*_])(?:\s*\2){2,}\s*($|\n)/.test(t) ||
            /\*\*[^*\n]+\*\*/.test(t) ||
            /__[^_\n]+__/.test(t) ||
            /\*[^*\n]+\*/.test(t) ||
            /_[^_\n]+_/.test(t) ||
            /~~[^~\n]+~~/.test(t) ||
            /`[^`\n]+`/.test(t) ||
            /\[[^\]\n]+\]\([^)]+\)/.test(t) ||
            /!\[[^\]]*\]\([^)]+\)/.test(t) ||
            /(^|\n)\s*[-*+]\s+\[[ xX]\]\s/.test(t) ||
            /(^|\n)\s*\|.+\|\s*\n\s*\|?\s*:?-+:?/.test(t)
        );
    }

    function parseTableRow(rowText) {
        let text = rowText.trim();
        if (text.startsWith('|')) text = text.substring(1);
        if (text.endsWith('|')) text = text.substring(0, text.length - 1);
        return text.split('|').map(cell => cell.trim());
    }

    function parseAlignments(separatorText) {
        let text = separatorText.trim();
        if (text.startsWith('|')) text = text.substring(1);
        if (text.endsWith('|')) text = text.substring(0, text.length - 1);
        return text.split('|').map(cell => {
            const trimmed = cell.trim();
            const left = trimmed.startsWith(':');
            const right = trimmed.endsWith(':');
            if (left && right) return 'center';
            if (right) return 'right';
            if (left) return 'left';
            return '';
        });
    }

    function parseInlineMarkdown(text) {
        const placeholders = [];
        const ph = (html) => {
            const token = `\x00MD${placeholders.length}\x00`;
            placeholders.push({ token, html });
            return token;
        };

        let src = String(text || '');

        // 1. Protect code spans
        src = src.replace(/`([^`]+)`/g, (_, code) =>
            ph(`<code>${escapeHtml(code)}</code>`)
        );

        // 2. Protect images ![alt](url "title")
        src = src.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
            const href = getSafeLinkHref(url);
            if (!href) return alt || '';
            const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
            return ph(`<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}"${titleAttr}>`);
        });

        // 3. Protect links [text](url "title")
        src = src.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, url, title) => {
            const href = getSafeLinkHref(url);
            if (!href) return label;
            const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
            return ph(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${parseInlineMarkdown(label)}</a>`);
        });

        // 4. Escape remaining HTML
        let html = escapeHtml(src);

        // 5. Apply inline formatting
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
        html = html.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
        html = html.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
        html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

        // 6. Restore placeholders
        placeholders.forEach(({ token, html: replacement }) => {
            html = html.replaceAll(token, replacement);
        });

        return html;
    }

    function isMarkdownBlockStart(line) {
        const t = line.trim();
        return (
            /^```/.test(t) ||
            /^#{1,6}\s+\S/.test(t) ||
            /^([-*_])(?:\s*\1){2,}\s*$/.test(t) ||
            /^>\s?/.test(t) ||
            /^\s*[-*+]\s+\S/.test(line) ||
            /^\s*\d+[.)]\s+\S/.test(line) ||
            /^\s*[-*+]\s+\[[ xX]\]\s/.test(line) ||
            (t.includes('|') && /\|/.test(t))
        );
    }

    function markdownToHtml(markdown) {
        const normalized = String(markdown || '').replace(/\r\n?/g, '\n').trim();
        if (!normalized) return '';

        const lines = normalized.split('\n');
        const htmlParts = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) {
                i++;
                continue;
            }

            // --- Fenced Code Blocks ---
            if (/^```([\w-]*)?\s*$/.test(trimmed)) {
                const codeLines = [];
                i++;
                while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
                    codeLines.push(lines[i]);
                    i++;
                }
                if (i < lines.length) i++;
                htmlParts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
                continue;
            }

            // --- Tables ---
            if (trimmed.includes('|') && i + 1 < lines.length) {
                const nextLine = lines[i + 1].trim();
                const isSeparator = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/.test(nextLine) && nextLine.includes('-');
                if (isSeparator) {
                    const headers = parseTableRow(trimmed);
                    const alignments = parseAlignments(nextLine);
                    const rows = [];
                    i += 2;
                    while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
                        rows.push(parseTableRow(lines[i].trim()));
                        i++;
                    }
                    let tableHtml = '<table><thead><tr>';
                    headers.forEach((h, idx) => {
                        const align = alignments[idx] ? ` align="${alignments[idx]}"` : '';
                        tableHtml += `<th${align}>${parseInlineMarkdown(h)}</th>`;
                    });
                    tableHtml += '</tr></thead><tbody>';
                    rows.forEach(row => {
                        tableHtml += '<tr>';
                        for (let idx = 0; idx < headers.length; idx++) {
                            const cell = row[idx] || '';
                            const align = alignments[idx] ? ` align="${alignments[idx]}"` : '';
                            tableHtml += `<td${align}>${parseInlineMarkdown(cell)}</td>`;
                        }
                        tableHtml += '</tr>';
                    });
                    tableHtml += '</tbody></table>';
                    htmlParts.push(tableHtml);
                    continue;
                }
            }

            // --- Headings ---
            const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                htmlParts.push(`<h${level}>${parseInlineMarkdown(headingMatch[2])}</h${level}>`);
                i++;
                continue;
            }

            // --- Horizontal Rules ---
            if (/^([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
                htmlParts.push('<hr>');
                i++;
                continue;
            }

            // --- Blockquotes ---
            if (/^>\s?/.test(trimmed)) {
                const quoteLines = [];
                while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
                    quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
                    i++;
                }
                htmlParts.push(`<blockquote>${markdownToHtml(quoteLines.join('\n'))}</blockquote>`);
                continue;
            }

            // --- Task Lists ---
            if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(line)) {
                const items = [];
                while (i < lines.length && /^\s*[-*+]\s+\[[ xX]\]\s/.test(lines[i])) {
                    const match = lines[i].match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
                    if (match) {
                        const checked = match[1].toLowerCase() === 'x';
                        items.push({ checked, text: match[2] });
                    }
                    i++;
                }
                const listItems = items.map(item => {
                    const checkedAttr = item.checked ? ' checked' : '';
                    return `<li class="task-list-item"><input type="checkbox"${checkedAttr} disabled>${parseInlineMarkdown(item.text)}</li>`;
                }).join('');
                htmlParts.push(`<ul class="task-list">${listItems}</ul>`);
                continue;
            }

            // --- Unordered Lists ---
            if (/^\s*[-*+]\s+\S/.test(line)) {
                const items = [];
                while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
                    items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
                    i++;
                }
                htmlParts.push(`<ul>${items.map(item => `<li>${parseInlineMarkdown(item)}</li>`).join('')}</ul>`);
                continue;
            }

            // --- Ordered Lists ---
            if (/^\s*\d+[.)]\s+\S/.test(line)) {
                const items = [];
                while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
                    items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
                    i++;
                }
                htmlParts.push(`<ol>${items.map(item => `<li>${parseInlineMarkdown(item)}</li>`).join('')}</ol>`);
                continue;
            }

            // --- Paragraphs ---
            const paraLines = [];
            while (i < lines.length && lines[i].trim() && !isMarkdownBlockStart(lines[i])) {
                paraLines.push(lines[i].trim());
                i++;
            }
            if (paraLines.length > 0) {
                htmlParts.push(`<p>${paraLines.map(parseInlineMarkdown).join('<br>')}</p>`);
            }
        }

        return sanitizeHtml(htmlParts.join(''));
    }

    function normalizeStoredContent(content) {
        const raw = typeof content === 'string' ? content : '';
        if (!raw.trim()) return '';
        if (!isProbablyHtml(raw) && looksLikeMarkdown(raw)) {
            return markdownToHtml(raw);
        }
        return sanitizeHtml(raw);
    }

    function formatTimestamp(isoString, includeTime = false) {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            if (isNaN(date.getTime())) return 'Invalid Date';

            const optionsDate = { year: 'numeric', month: 'short', day: 'numeric' };
            const optionsTime = { hour: '2-digit', minute: '2-digit' };

            if (includeTime) {
                return `${date.toLocaleDateString(undefined, optionsDate)}, ${date.toLocaleTimeString(undefined, optionsTime)}`;
            }

            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);

            if (date.toDateString() === today.toDateString()) {
                return date.toLocaleTimeString(undefined, optionsTime);
            }
            if (date.toDateString() === yesterday.toDateString()) {
                return 'Yesterday';
            }
            return date.toLocaleDateString(undefined, optionsDate);
        } catch {
            return 'Invalid Date';
        }
    }

    return {
        escapeHtml,
        getSafeLinkHref,
        sanitizeHtml,
        getPlainTextFromHtml,
        isProbablyHtml,
        isValidDateString,
        looksLikeMarkdown,
        markdownToHtml,
        normalizeStoredContent,
        formatTimestamp
    };
})();

// =============================================================================
// 2. Storage System
// =============================================================================
const StorageSystem = (() => {
    function generateId() {
        return Date.now().toString() + Math.random().toString(16).substring(2);
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function validateNote(note) {
        let changed = false;
        if (!note.id) {
            note.id = generateId();
            changed = true;
        }
        if (!MarkdownEngine.isValidDateString(note.timestamp)) {
            note.timestamp = new Date().toISOString();
            changed = true;
        }
        if (typeof note.title !== 'string') {
            note.title = '';
            changed = true;
        }
        if (typeof note.content !== 'string') {
            note.content = '';
            changed = true;
        }
        const normalized = MarkdownEngine.normalizeStoredContent(note.content);
        if (normalized !== note.content) {
            note.content = normalized;
            changed = true;
        }
        return { note, changed };
    }

    function loadNotesFromStorage() {
        try {
            let notes = JSON.parse(localStorage.getItem('notes')) || [];
            let migrated = false;
            notes.forEach(note => {
                const result = validateNote(note);
                if (result.changed) migrated = true;
            });
            notes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            if (migrated) saveNotesToStorage(notes);
            return notes;
        } catch (error) {
            console.error('Failed to load notes from storage:', error);
            localStorage.removeItem('notes');
            return [];
        }
    }

    function saveNotesToStorage(notes) {
        try {
            localStorage.setItem('notes', JSON.stringify(notes));
        } catch (error) {
            console.error('Failed to save notes:', error);
        }
    }

    function createNewNote() {
        return {
            id: generateId(),
            title: '',
            content: '',
            timestamp: new Date().toISOString()
        };
    }

    function updateNoteInArray(notes, activeIndex, newTitle, newContent) {
        if (activeIndex === null || activeIndex >= notes.length) return null;

        const note = notes[activeIndex];
        const contentChanged = note.title !== newTitle || note.content !== newContent;

        if (!contentChanged) return null;

        note.title = newTitle;
        note.content = newContent;
        note.timestamp = new Date().toISOString();

        let newActiveIdx = activeIndex;

        if (activeIndex !== 0) {
            notes.splice(activeIndex, 1);
            notes.unshift(note);
            newActiveIdx = 0;
        }

        saveNotesToStorage(notes);
        return { notes, newActiveIndex: newActiveIdx };
    }

    function exportAllNotesAsJson(notes) {
        if (notes.length === 0) return false;
        try {
            const json = JSON.stringify(notes, null, 2);
            const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
            downloadBlob(blob, `notes_export_${new Date().toISOString().split('T')[0]}.json`);
            return true;
        } catch (error) {
            console.error('Export failed:', error);
            return false;
        }
    }

    function exportNoteAsText(note) {
        if (!note) return false;
        try {
            const title = note.title || 'Untitled';
            const text = MarkdownEngine.getPlainTextFromHtml(note.content);
            const content = `Title: ${note.title}\n\n---\n\n${text}`;
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            downloadBlob(blob, `${title.replace(/[^a-z0-9 _-]/gi, '_')}.txt`);
            return true;
        } catch (error) {
            console.error('Export note failed:', error);
            return false;
        }
    }

    function importNotesFromFile(file, existingNotes) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    let toImport = [];

                    if (Array.isArray(data)) {
                        toImport = data;
                    } else if (data && Array.isArray(data.notes)) {
                        toImport = data.notes;
                    } else {
                        throw new Error('Invalid format: Expected an array of notes.');
                    }

                    const valid = toImport
                        .filter(n => n && typeof n.content === 'string')
                        .map(n => ({
                            id: (typeof n.id === 'string' && n.id) ? n.id : generateId(),
                            title: typeof n.title === 'string' ? n.title : '',
                            content: MarkdownEngine.normalizeStoredContent(n.content),
                            timestamp: MarkdownEngine.isValidDateString(n.timestamp) ? n.timestamp : new Date().toISOString()
                        }));

                    const invalidCount = toImport.length - valid.length;

                    if (valid.length === 0) {
                        reject(new Error(
                            toImport.length > 0 ? 'No valid notes found in the file.' : 'File contains no notes.'
                        ));
                        return;
                    }

                    const existingIds = new Set(existingNotes.map(n => n.id));
                    const newNotes = valid.filter(n => !existingIds.has(n.id));
                    const skippedCount = valid.length - newNotes.length;

                    const merged = [...newNotes, ...existingNotes];
                    merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                    resolve({
                        notes: merged,
                        stats: {
                            imported: newNotes.length,
                            skipped: skippedCount,
                            invalid: invalidCount
                        }
                    });
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Error reading file.'));
            reader.readAsText(file);
        });
    }

    return {
        loadNotesFromStorage,
        saveNotesToStorage,
        createNewNote,
        updateNoteInArray,
        exportAllNotesAsJson,
        exportNoteAsText,
        importNotesFromFile
    };
})();

// =============================================================================
// 3. Search Engine
// =============================================================================
const SearchEngine = (() => {
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function parseSearchQuery(query) {
        const tokens = [];
        const regex = /([+-]?"[^"]+")|([+-]?[\w'-]+)/g;
        let match;

        while ((match = regex.exec(query)) !== null) {
            let term = match[0];
            let type = 'normal';
            let text = term;

            if (term.startsWith('+')) {
                type = 'required';
                text = term.substring(1);
            } else if (term.startsWith('-')) {
                type = 'excluded';
                text = term.substring(1);
            }

            if (text.startsWith('"') && text.endsWith('"')) {
                type = (type === 'required' || type === 'excluded') ? type : 'phrase';
                text = text.substring(1, text.length - 1);
            }

            text = text.trim().toLowerCase();
            if (text) {
                tokens.push({ text, type });
            }
        }

        return tokens;
    }

    function performSearch(notes, query) {
        const tokens = parseSearchQuery(query);
        if (!tokens.length) return notes;

        return notes
            .map(note => {
                const titleText = note.title.toLowerCase();
                const contentText = MarkdownEngine.getPlainTextFromHtml(note.content).toLowerCase();

                let score = 0;
                let meetsRequirements = true;
                let matchedPositive = false;

                tokens.forEach(token => {
                    let found = false;
                    if (!token.text) return;

                    try {
                        const pattern = token.type === 'phrase'
                            ? escapeRegExp(token.text)
                            : `\\b${escapeRegExp(token.text)}`;
                        const regex = new RegExp(pattern, 'gi');

                        if (titleText.match(regex)) {
                            if (token.type !== 'excluded') score += 10;
                            found = true;
                        }
                        if (contentText.match(regex)) {
                            if (token.type !== 'excluded') score += 5;
                            found = true;
                        }
                    } catch {
                        // ignore regex errors
                    }

                    if (token.type === 'required' && !found) meetsRequirements = false;
                    if (token.type === 'excluded' && found) meetsRequirements = false;
                    if (token.type !== 'excluded' && found) matchedPositive = true;
                });

                const hasPositiveTokens = tokens.some(t => t.type !== 'excluded');
                if (!meetsRequirements || (hasPositiveTokens && !matchedPositive)) {
                    return null;
                }

                return { note, score };
            })
            .filter(r => r !== null)
            .sort((a, b) => b.score - a.score)
            .map(r => r.note);
    }

    function getHighlightTerms(query) {
        return parseSearchQuery(query)
            .filter(t => t.type !== 'excluded' && t.text)
            .map(t => t.text)
            .sort((a, b) => b.length - a.length);
    }

    function highlightMatchesInText(text, terms) {
        const value = String(text || '');
        if (!terms.length) return MarkdownEngine.escapeHtml(value);

        const pattern = terms.map(escapeRegExp).join('|');
        if (!pattern) return MarkdownEngine.escapeHtml(value);

        const regex = new RegExp(pattern, 'gi');
        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(value)) !== null) {
            result += MarkdownEngine.escapeHtml(value.slice(lastIndex, match.index));
            result += `<span class="highlight-match">${MarkdownEngine.escapeHtml(match[0])}</span>`;
            lastIndex = regex.lastIndex;
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }

        result += MarkdownEngine.escapeHtml(value.slice(lastIndex));
        return result;
    }

    return {
        escapeRegExp,
        parseSearchQuery,
        performSearch,
        getHighlightTerms,
        highlightMatchesInText
    };
})();

// =============================================================================
// 4. Editor System
// =============================================================================
const EditorSystem = (() => {
    const WORDS_PER_MINUTE = 200;

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

    let onContentChange = () => {};
    let getMainViewState = () => 'placeholder';

    function initEditor(config) {
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

    function loadNoteIntoEditor(note) {
        if (!note) return;
        noteTitleInput.value = note.title;
        noteBodyEditable.innerHTML = MarkdownEngine.normalizeStoredContent(note.content);
        updateStatusBar();
        updateToolbarStates();
    }

    function getEditorTitle() {
        return noteTitleInput ? noteTitleInput.value : '';
    }

    function getEditorPlainText() {
        return (noteBodyEditable.innerText || '').replace(/\u00a0/g, ' ');
    }

    function getEditorContentForStorage() {
        applyMarkdownFormattingIfNeeded();
        return MarkdownEngine.sanitizeHtml(noteBodyEditable.innerHTML.trim());
    }

    function resetEditorFields() {
        if (noteTitleInput) noteTitleInput.value = '';
        if (noteBodyEditable) noteBodyEditable.innerHTML = '';
        updateStatusBar();
        clearToolbarStates();
    }

    function applyFormat(command, value) {
        if (!noteBodyEditable.contains(document.activeElement)) {
            noteBodyEditable.focus();
        }
        const cmdValue = (command === 'formatBlock' && value) ? `<${value}>` : (value || null);
        document.execCommand(command, false, cmdValue);
        updateToolbarStates();
    }

    function handleToolbarClick(e) {
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

    function handleFormattingKeys(e) {
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

    function handleMarkdownShortcuts(e) {
        if (e.key !== ' ' && e.key !== 'Spacebar') return;

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const container = range.startContainer;

        if (container.nodeType !== Node.TEXT_NODE) return;

        const text = container.textContent;
        const offset = range.startOffset;
        const before = text.substring(0, offset);

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

    function handlePaste(e) {
        e.preventDefault();
        const text = (e.originalEvent || e).clipboardData?.getData('text/plain');
        if (!text) return;

        if (MarkdownEngine.looksLikeMarkdown(text)) {
            insertHtmlAtSelection(MarkdownEngine.markdownToHtml(text));
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
        template.innerHTML = MarkdownEngine.sanitizeHtml(html);
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

    function editorContainsMeaningfulHtml() {
        return Boolean(noteBodyEditable.querySelector(
            'a,b,blockquote,code,em,h1,h2,h3,h4,h5,h6,hr,i,li,ol,pre,s,strike,strong,u,ul,table,img,input'
        ));
    }

    function applyMarkdownFormattingIfNeeded() {
        if (isApplyingFormat) return;
        if (getMainViewState() !== 'editor') return;

        const plainText = getEditorPlainText().trim();
        if (!plainText || !MarkdownEngine.looksLikeMarkdown(plainText)) return;
        if (editorContainsMeaningHtml()) return;

        const html = MarkdownEngine.markdownToHtml(plainText);
        if (!html || html === MarkdownEngine.sanitizeHtml(noteBodyEditable.innerHTML.trim())) return;

        const hadFocus = document.activeElement === noteBodyEditable;
        isApplyingFormat = true;
        noteBodyEditable.innerHTML = html;
        isApplyingFormat = false;

        if (hadFocus) placeCaretAtEnd(noteBodyEditable);
        updateStatusBar();
        updateToolbarStates();
    }

    // Workaround helper to check elements correctly
    function editorContainsMeaningHtml() {
        return Boolean(noteBodyEditable.querySelector(
            'a,b,blockquote,code,em,h1,h2,h3,h4,h5,h6,hr,i,li,ol,pre,s,strike,strong,u,ul,table,img,input'
        ));
    }

    function placeCaretAtEnd(element) {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function handleEditorBlur() {
        clearToolbarStates();
        applyMarkdownFormattingIfNeeded();
    }

    function updateStatusBar() {
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

    function updateLastModified(timestamp) {
        if (lastModifiedEl) {
            lastModifiedEl.textContent = timestamp
                ? `Modified: ${MarkdownEngine.formatTimestamp(timestamp, true)}`
                : '';
        }
    }

    function updateToolbarStates() {
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
                        // ignore
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

    function clearToolbarStates() {
        if (editorToolbar) {
            editorToolbar.querySelectorAll('.toolbar-btn.active').forEach(btn =>
                btn.classList.remove('active')
            );
        }
    }

    function getIsApplyingFormat() {
        return isApplyingFormat;
    }

    return {
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
    };
})();

// =============================================================================
// 5. UI Controls
// =============================================================================
const UISystem = (() => {
    let sidebar, overlay, notesListEl, notesCountEl;
    let editorPlaceholder, editorWrapper, searchResultsView;
    let searchResultsHeaderQuery, searchResultsListContainer, searchNoResultsMsg;
    let themeSwitchBtn, resizeHandle;
    let notification, notificationMessage, notificationIcon;
    let sidebarToggleBtn;

    let mainViewCurrentState = 'placeholder';
    let isResizing = false;
    let darkMode = localStorage.getItem('darkMode') !== 'false';

    let onNoteClick = () => {};
    let onSearchResultClick = () => {};

    function initUI(config) {
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

        if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleSidebar);
        if (overlay) overlay.addEventListener('click', toggleSidebar);
        if (themeSwitchBtn) themeSwitchBtn.addEventListener('click', toggleTheme);
        if (resizeHandle) resizeHandle.addEventListener('mousedown', startResize);

        applyTheme();
        loadSidebarWidth();
    }

    function getMainViewState() {
        return mainViewCurrentState;
    }

    function setMainViewState(state, activeNoteIndex = null, notesLength = 0) {
        mainViewCurrentState = state;

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

    function renderNotesList(notesToRender, allNotes, activeNoteIndex, searchQuery) {
        notesListEl.innerHTML = '';

        notesToRender.forEach(note => {
            const originalIndex = allNotes.findIndex(n => n.id === note.id);
            if (originalIndex === -1) return;

            const noteItem = document.createElement('li');
            noteItem.classList.add('note-item');
            noteItem.setAttribute('data-index', originalIndex);

            const previewText = MarkdownEngine.getPlainTextFromHtml(note.content);
            const query = searchQuery || '';
            const terms = query ? SearchEngine.getHighlightTerms(query) : [];
            const title = SearchEngine.highlightMatchesInText(note.title || 'Untitled', terms);
            const preview = SearchEngine.highlightMatchesInText(previewText.substring(0, 100), terms);

            noteItem.innerHTML = `
                <div class="note-item-title">${title}</div>
                <div class="note-item-preview">${preview || '<span style="color: var(--text-tertiary);">Empty Note</span>'}</div>
                <div class="timestamp">${MarkdownEngine.escapeHtml(MarkdownEngine.formatTimestamp(note.timestamp))}</div>
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

    function highlightActiveNoteItem(activeNoteIndex) {
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

    function renderSearchResultsInMainView(results, query, allNotes) {
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

                const contentText = MarkdownEngine.getPlainTextFromHtml(note.content);
                let snippetText = contentText.substring(0, 250);

                const terms = SearchEngine.parseSearchQuery(query);
                const positiveTerms = terms.filter(t => t.type !== 'excluded' && t.text);
                const positiveTermText = positiveTerms.map(t => t.text).sort((a, b) => b.length - a.length);

                let firstMatchIndex = -1;
                if (positiveTerms.length > 0) {
                    for (const term of positiveTerms) {
                        try {
                            const pattern = term.type === 'phrase'
                                ? SearchEngine.escapeRegExp(term.text)
                                : `\\b${SearchEngine.escapeRegExp(term.text)}`;
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

                const titleHtml = SearchEngine.highlightMatchesInText(note.title || 'Untitled', positiveTermText);
                const snippetHtml = SearchEngine.highlightMatchesInText(snippetText, positiveTermText);

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

    function showNotification(message, isError = false) {
        if (!notification) return;

        notificationMessage.textContent = message;
        notificationIcon.className = isError
            ? 'fas fa-exclamation-circle error-icon'
            : 'fas fa-check-circle success-icon';
        notification.classList.toggle('error', isError);

        clearTimeout(notification._timerId);
        notification.classList.remove('show');
        void notification.offsetWidth;

        notification.classList.add('show');
        notification._timerId = setTimeout(() => {
            notification.classList.remove('show');
        }, 3500);
    }

    function applyTheme() {
        document.body.classList.toggle('light-mode', !darkMode);
        if (themeSwitchBtn) {
            themeSwitchBtn.innerHTML = darkMode ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            themeSwitchBtn.title = darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        }
    }

    function toggleTheme() {
        darkMode = !darkMode;
        localStorage.setItem('darkMode', darkMode);
        applyTheme();
    }

    function toggleSidebar() {
        sidebar.classList.toggle('active');
        if (overlay) overlay.classList.toggle('active', sidebar.classList.contains('active'));
    }

    function loadSidebarWidth() {
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

    return {
        initUI,
        getMainViewState,
        setMainViewState,
        renderNotesList,
        highlightActiveNoteItem,
        renderSearchResultsInMainView,
        showNotification,
        toggleSidebar,
        loadSidebarWidth
    };
})();

// =============================================================================
// 6. AI Enhancer
// =============================================================================
const AiEnhancer = (() => {
    let aiModal, aiEnhanceBtn, aiCancelBtn, aiSubmitBtn, aiAcceptBtn;
    let geminiApiKeyInput, toggleApiKeyVisibilityBtn;
    let aiPreviewSection, aiPreviewContent, aiLoadingEl;
    let aiOptButtons;

    let selectedAiAction = 'enhance';
    let enhancedTextResult = '';

    let getEditorPlainText = () => '';
    let getMainViewState = () => 'placeholder';
    let getActiveNoteIndex = () => null;
    let onApplyEnhancement = () => {};
    let showNotification = () => {};

    function initAiEnhancer(config) {
        aiModal = document.getElementById('ai-modal');
        aiEnhanceBtn = document.getElementById('ai-enhance-btn');
        aiCancelBtn = document.getElementById('ai-cancel-btn');
        aiSubmitBtn = document.getElementById('ai-submit-btn');
        aiAcceptBtn = document.getElementById('ai-accept-btn');
        geminiApiKeyInput = document.getElementById('gemini-api-key');
        toggleApiKeyVisibilityBtn = document.getElementById('toggle-api-key-visibility');
        aiPreviewSection = document.querySelector('.ai-preview-section');
        aiPreviewContent = document.querySelector('.ai-preview-content');
        aiLoadingEl = document.querySelector('.ai-loading');
        aiOptButtons = document.querySelectorAll('.ai-opt-btn');

        getEditorPlainText = config.getEditorPlainText || (() => '');
        getMainViewState = config.getMainViewState || (() => 'placeholder');
        getActiveNoteIndex = config.getActiveNoteIndex || (() => null);
        onApplyEnhancement = config.onApplyEnhancement || (() => {});
        showNotification = config.showNotification || (() => {});

        if (!aiEnhanceBtn) return;

        const savedKey = localStorage.getItem('gemini_api_key') || '';
        if (geminiApiKeyInput) {
            geminiApiKeyInput.value = savedKey;
        }

        if (toggleApiKeyVisibilityBtn && geminiApiKeyInput) {
            toggleApiKeyVisibilityBtn.addEventListener('click', () => {
                const icon = toggleApiKeyVisibilityBtn.querySelector('i');
                if (geminiApiKeyInput.type === 'password') {
                    geminiApiKeyInput.type = 'text';
                    icon.className = 'fas fa-eye-slash';
                } else {
                    geminiApiKeyInput.type = 'password';
                    icon.className = 'fas fa-eye';
                }
            });
        }

        aiEnhanceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (getMainViewState() !== 'editor' || getActiveNoteIndex() === null) {
                showNotification('Please select a note to enhance first.', true);
                return;
            }

            const envKey = (window.env && window.env.GEMINI_API_KEY) || '';
            if (envKey && envKey !== 'YOUR_GEMINI_API_KEY_HERE' && geminiApiKeyInput) {
                if (!geminiApiKeyInput.value) {
                    geminiApiKeyInput.value = envKey;
                }
            }

            aiPreviewSection.style.display = 'none';
            aiPreviewContent.innerHTML = '';
            aiAcceptBtn.style.display = 'none';
            aiSubmitBtn.style.display = 'inline-block';
            aiLoadingEl.style.display = 'none';

            aiModal.classList.add('show');
        });

        aiCancelBtn.addEventListener('click', closeModal);
        aiModal.querySelector('.close-modal-btn').addEventListener('click', closeModal);

        aiOptButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                aiOptButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedAiAction = btn.dataset.action;
            });
        });

        if (geminiApiKeyInput) {
            geminiApiKeyInput.addEventListener('input', () => {
                localStorage.setItem('gemini_api_key', geminiApiKeyInput.value.trim());
            });
        }

        aiSubmitBtn.addEventListener('click', runAiEnhancement);

        aiAcceptBtn.addEventListener('click', () => {
            if (!enhancedTextResult) return;
            onApplyEnhancement(enhancedTextResult);
            closeModal();
            showNotification('AI enhancements applied successfully!');
        });
    }

    function closeModal() {
        if (aiModal) aiModal.classList.remove('show');
    }

    async function runAiEnhancement() {
        const envKey = (window.env && window.env.GEMINI_API_KEY) || '';
        let apiKey = (envKey !== 'YOUR_GEMINI_API_KEY_HERE') ? envKey : '';

        if (!apiKey && geminiApiKeyInput) {
            apiKey = geminiApiKeyInput.value.trim();
        }

        if (!apiKey) {
            showNotification('Please enter a Gemini API Key or configure it in env.js', true);
            return;
        }

        if (geminiApiKeyInput && geminiApiKeyInput.value.trim()) {
            localStorage.setItem('gemini_api_key', geminiApiKeyInput.value.trim());
        }

        const noteText = getEditorPlainText();
        if (!noteText.trim()) {
            showNotification('Note is empty! Type some text to enhance.', true);
            return;
        }

        aiLoadingEl.style.display = 'flex';
        aiPreviewSection.style.display = 'none';
        aiSubmitBtn.style.display = 'none';

        const prompts = {
            enhance: `You are a professional Markdown and rich text enhancer. Convert the following notes into clean, beautiful, properly structured Markdown. Use headings (# for title, ## for sections, ### for subsections) where logical. Group items into bulleted or ordered lists where appropriate. If data looks structured, create a clean Markdown table with alignments. Retain ALL existing information. ONLY return the enhanced Markdown text, do not include any introductory or concluding conversational filler:\n\n${noteText}`,
            summarize: `You are a professional text summarizer. Create a concise, structured summary of the following notes. Use bold text for key terms and a clean bulleted list for major takeaways and action points. Retain the core meaning. ONLY return the summary in Markdown format, without any conversational preamble:\n\n${noteText}`,
            grammar: `You are an expert copyeditor. Fix any grammatical, spelling, punctuation, or stylistic errors in the following text. Make it flow naturally and read professionally while keeping the original meaning and tone intact. Use clean Markdown formatting. ONLY return the polished Markdown text, without any conversational preamble:\n\n${noteText}`,
            todo: `You are a productivity assistant. Analyze the following notes and extract all action items, tasks, and follow-ups. Format them as a clean, structured to-do list using Markdown checkboxes (e.g. - [ ] Task name). If there are no clear tasks, formulate logical action steps based on the note's contents. ONLY return the Markdown task list, without any conversational preamble:\n\n${noteText}`
        };

        const prompt = prompts[selectedAiAction] || prompts.enhance;

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemma-2-27b-it:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.2 }
                    })
                }
            );

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error?.message || `HTTP error ${response.status}`);
            }

            const data = await response.json();
            const geminiText = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!geminiText) {
                throw new Error('No response received from Gemini model.');
            }

            let cleaned = geminiText.trim();
            if (cleaned.startsWith('```markdown')) {
                cleaned = cleaned.substring(11);
            } else if (cleaned.startsWith('```')) {
                cleaned = cleaned.substring(3);
            }
            if (cleaned.endsWith('```')) {
                cleaned = cleaned.substring(0, cleaned.length - 3);
            }
            cleaned = cleaned.trim();

            enhancedTextResult = MarkdownEngine.markdownToHtml(cleaned);
            aiPreviewContent.innerHTML = enhancedTextResult;

            aiLoadingEl.style.display = 'none';
            aiPreviewSection.style.display = 'block';
            aiAcceptBtn.style.display = 'inline-block';
            aiSubmitBtn.style.display = 'none';

        } catch (error) {
            console.error('AI enhancement failed:', error);
            aiLoadingEl.style.display = 'none';
            aiSubmitBtn.style.display = 'inline-block';
            showNotification(`AI enhancement failed: ${error.message}`, true);
        }
    }

    return {
        initAiEnhancer
    };
})();

// =============================================================================
// 7. Orchestrator & State Management
// =============================================================================
(() => {
    let notes = [];
    let activeNoteIndex = null;
    let autoSaveTimeout = null;
    let searchTimeout = null;

    const AUTO_SAVE_DELAY = 1500;

    const dom = {
        noteTitleInput: document.querySelector('.note-title'),
        noteBodyEditable: document.querySelector('.note-body'),
        editorToolbar: document.querySelector('.editor-toolbar'),
        wordCountEl: document.querySelector('.word-count'),
        charCountEl: document.querySelector('.char-count'),
        readingTimeEl: document.querySelector('.reading-time'),
        lastModifiedEl: document.querySelector('.last-modified'),
        fontSizeValEl: document.getElementById('font-size-val'),

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

    function initializeApp() {
        notes = StorageSystem.loadNotesFromStorage();

        EditorSystem.initEditor({
            noteTitleInput: dom.noteTitleInput,
            noteBodyEditable: dom.noteBodyEditable,
            editorToolbar: dom.editorToolbar,
            wordCountEl: dom.wordCountEl,
            charCountEl: dom.charCountEl,
            readingTimeEl: dom.readingTimeEl,
            lastModifiedEl: dom.lastModifiedEl,
            fontSizeValEl: dom.fontSizeValEl,
            onContentChange: handleEditorInput,
            getMainViewState: UISystem.getMainViewState
        });

        UISystem.initUI({
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

        AiEnhancer.initAiEnhancer({
            getEditorPlainText: EditorSystem.getEditorPlainText,
            getMainViewState: UISystem.getMainViewState,
            getActiveNoteIndex: () => activeNoteIndex,
            onApplyEnhancement: applyAiEnhancement,
            showNotification: UISystem.showNotification
        });

        UISystem.renderNotesList(notes, notes, activeNoteIndex, '');
        UISystem.setMainViewState('placeholder');

        addEventListeners();
        registerServiceWorker();
    }

    function addEventListeners() {
        dom.newNoteBtn.addEventListener('click', createNote);
        dom.deleteNoteBtn.addEventListener('click', deleteNote);

        dom.noteTitleInput.addEventListener('input', startAutoSaveTimer);
        dom.noteBodyEditable.addEventListener('input', handleEditorInput);
        dom.noteBodyEditable.addEventListener('paste', EditorSystem.handlePaste);
        dom.noteBodyEditable.addEventListener('focus', EditorSystem.updateToolbarStates);
        dom.noteBodyEditable.addEventListener('blur', handleBlur);
        dom.noteBodyEditable.addEventListener('keyup', EditorSystem.updateToolbarStates);
        dom.noteBodyEditable.addEventListener('keydown', EditorSystem.handleFormattingKeys);
        dom.noteBodyEditable.addEventListener('keydown', EditorSystem.handleMarkdownShortcuts);
        dom.editorToolbar.addEventListener('click', EditorSystem.handleToolbarClick);

        document.addEventListener('selectionchange', handleSelectionChange);

        dom.searchInput.addEventListener('input', handleSearchInput);
        dom.searchInput.addEventListener('search', () => {
            if (!dom.searchInput.value) handleSearchInput();
        });

        dom.exportAllBtn.addEventListener('click', handleExportAll);
        dom.importBtn.addEventListener('click', () => dom.importFileInput.click());
        dom.importFileInput.addEventListener('change', handleImport);
        dom.exportNoteBtn.addEventListener('click', handleExportCurrentNote);

        window.addEventListener('resize', UISystem.loadSidebarWidth);
        window.addEventListener('beforeunload', flushPendingNoteSave);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushPendingNoteSave();
        });
    }

    function createNote() {
        if (activeNoteIndex !== null) {
            clearTimeout(autoSaveTimeout);
            saveCurrentNote(true);
        }

        const newNote = StorageSystem.createNewNote();
        notes.unshift(newNote);
        StorageSystem.saveNotesToStorage(notes);

        if (UISystem.getMainViewState() === 'search' || dom.searchInput.value.trim()) {
            dom.searchInput.value = '';
        }

        UISystem.renderNotesList(notes, notes, 0, '');
        loadNote(0);
        dom.noteTitleInput.focus();
    }

    function loadNote(index) {
        if (index < 0 || index >= notes.length) {
            resetEditor();
            return;
        }

        if (activeNoteIndex !== null && activeNoteIndex !== index) {
            clearTimeout(autoSaveTimeout);
            saveCurrentNote(true);
        }

        activeNoteIndex = index;
        const note = notes[index];

        EditorSystem.loadNoteIntoEditor(note);
        UISystem.setMainViewState('editor', activeNoteIndex, notes.length);
        EditorSystem.updateLastModified(note.timestamp);
        UISystem.highlightActiveNoteItem(activeNoteIndex);

        if (window.innerWidth <= 768 && dom.sidebar.classList.contains('active')) {
            UISystem.toggleSidebar();
        }
    }

    function saveCurrentNote(forceMarkdown = false) {
        if (activeNoteIndex === null || activeNoteIndex >= notes.length) return;

        const newTitle = EditorSystem.getEditorTitle();
        const newContent = EditorSystem.getEditorContentForStorage();

        const result = StorageSystem.updateNoteInArray(notes, activeNoteIndex, newTitle, newContent);
        if (result) {
            notes = result.notes;
            activeNoteIndex = result.newActiveIndex;
            UISystem.renderNotesList(notes, notes, activeNoteIndex, dom.searchInput.value.trim());
            EditorSystem.updateLastModified(notes[activeNoteIndex].timestamp);
        }
    }

    function deleteNote() {
        if (activeNoteIndex === null || activeNoteIndex >= notes.length) return;

        const noteToDelete = notes[activeNoteIndex];
        const noteTitle = noteToDelete.title || 'Untitled';

        if (confirm(`Are you sure you want to delete "${noteTitle}"? This cannot be undone.`)) {
            const wasSearching = UISystem.getMainViewState() === 'search';

            notes.splice(activeNoteIndex, 1);
            StorageSystem.saveNotesToStorage(notes);
            activeNoteIndex = null;

            if (wasSearching) {
                handleSearchInput();
            } else {
                UISystem.renderNotesList(notes, notes, activeNoteIndex, '');
                resetEditor();
            }

            UISystem.showNotification(`Note "${noteTitle}" deleted.`);
        }
    }

    function resetEditor() {
        activeNoteIndex = null;
        EditorSystem.resetEditorFields();
        UISystem.setMainViewState('placeholder');
        EditorSystem.updateLastModified(null);
        UISystem.highlightActiveNoteItem(null);
    }

    function handleEditorInput() {
        if (EditorSystem.getIsApplyingFormat()) return;
        startAutoSaveTimer();
        EditorSystem.updateStatusBar();
        if (document.activeElement === dom.noteBodyEditable) {
            EditorSystem.updateToolbarStates();
        }
    }

    function handleSelectionChange() {
        if (document.activeElement === dom.noteBodyEditable) {
            EditorSystem.updateToolbarStates();
        }
    }

    function handleBlur() {
        EditorSystem.handleEditorBlur();
        if (UISystem.getMainViewState() === 'editor') {
            saveCurrentNote(true);
        }
    }

    function startAutoSaveTimer() {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(() => {
            if (UISystem.getMainViewState() === 'editor') {
                saveCurrentNote();
            }
        }, AUTO_SAVE_DELAY);
    }

    function flushPendingNoteSave() {
        clearTimeout(autoSaveTimeout);
        if (UISystem.getMainViewState() === 'editor') {
            saveCurrentNote(true);
        }
    }

    function handleSearchInput() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const query = dom.searchInput.value.trim();

            if (!query) {
                UISystem.renderNotesList(notes, notes, activeNoteIndex, '');
                if (activeNoteIndex !== null) {
                    UISystem.setMainViewState('editor', activeNoteIndex, notes.length);
                    UISystem.highlightActiveNoteItem(activeNoteIndex);
                } else {
                    UISystem.setMainViewState('placeholder');
                }
                return;
            }

            const searchResults = SearchEngine.performSearch(notes, query);
            UISystem.renderNotesList(searchResults, notes, activeNoteIndex, query);
            UISystem.renderSearchResultsInMainView(searchResults, query, notes);
            UISystem.setMainViewState('search');
        }, 300);
    }

    function handleNoteClick(originalIndex) {
        clearTimeout(autoSaveTimeout);
        saveCurrentNote(true);
        loadNote(originalIndex);
    }

    function handleSearchResultClick(originalIndex) {
        clearTimeout(autoSaveTimeout);
        loadNote(originalIndex);
    }

    function handleExportAll() {
        if (notes.length === 0) {
            UISystem.showNotification('No notes to export.', true);
            return;
        }
        if (StorageSystem.exportAllNotesAsJson(notes)) {
            UISystem.showNotification('All notes exported successfully!');
        } else {
            UISystem.showNotification('Failed to export notes.', true);
        }
    }

    function handleExportCurrentNote() {
        if (UISystem.getMainViewState() !== 'editor' || activeNoteIndex === null) {
            UISystem.showNotification('No active note selected to export.', true);
            return;
        }
        const note = notes[activeNoteIndex];
        const title = note.title || 'Untitled';
        if (StorageSystem.exportNoteAsText(note)) {
            UISystem.showNotification(`Note "${title}" exported as text.`);
        } else {
            UISystem.showNotification('Failed to export current note.', true);
        }
    }

    async function handleImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const result = await StorageSystem.importNotesFromFile(file, notes);
            notes = result.notes;
            StorageSystem.saveNotesToStorage(notes);

            if (UISystem.getMainViewState() === 'search' || dom.searchInput.value.trim()) {
                dom.searchInput.value = '';
            }
            UISystem.renderNotesList(notes, notes, null, '');
            resetEditor();

            let message = `${result.stats.imported} new note(s) imported.`;
            if (result.stats.skipped > 0) message += ` ${result.stats.skipped} existing notes skipped.`;
            if (result.stats.invalid > 0) message += ` ${result.stats.invalid} invalid items ignored.`;
            UISystem.showNotification(message);
        } catch (error) {
            UISystem.showNotification(`Import failed: ${error.message}`, true);
        } finally {
            dom.importFileInput.value = '';
        }
    }

    function applyAiEnhancement(enhancedHtml) {
        if (!enhancedHtml || activeNoteIndex === null) return;
        dom.noteBodyEditable.innerHTML = enhancedHtml;
        handleEditorInput();
    }

    function registerServiceWorker() {
        const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
        if (!('serviceWorker' in navigator) || !(window.isSecureContext || isLocalhost)) return;

        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js')
                .catch(error => console.warn('Service worker registration failed:', error));
        });
    }

    // Start App
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeApp);
    } else {
        initializeApp();
    }
})();
