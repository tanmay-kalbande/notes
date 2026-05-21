// =============================================================================
// modules/markdown.js — Markdown Parser, HTML Sanitizer, Utilities
// =============================================================================

const ALLOWED_CONTENT_TAGS = new Set([
    'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span',
    'strike', 'strong', 'u', 'ul', 'input',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
]);

const BLOCKED_CONTENT_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'
]);

// -----------------------------------------------------------------------------
// HTML Utilities
// -----------------------------------------------------------------------------

export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function getSafeLinkHref(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) return null;
    if (/^(#|\/|\.\\/|\.\.\/)/.test(trimmed)) return trimmed;
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

export function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html || '';
    cleanContentNode(template.content);
    return template.innerHTML;
}

export function getPlainTextFromHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = sanitizeHtml(html || '');
    return div.textContent || div.innerText || '';
}

export function isProbablyHtml(value) {
    return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function isValidDateString(value) {
    if (!value) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
}

// -----------------------------------------------------------------------------
// Markdown Detection
// -----------------------------------------------------------------------------

export function looksLikeMarkdown(text) {
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
        /~~[^~\n]+~~/.test(t) ||
        /`[^`\n]+`/.test(t) ||
        /\[[^\]\n]+\]\([^)]+\)/.test(t) ||
        /!\[[^\]]*\]\([^)]+\)/.test(t) ||
        /(^|\n)\s*[-*+]\s+\[[ xX]\]\s/.test(t) ||
        /(^|\n)\s*\|.+\|\s*\n\s*\|?\s*:?-+:?/.test(t)
    );
}

// -----------------------------------------------------------------------------
// Table Parsing Helpers
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Inline Markdown Parser
// -----------------------------------------------------------------------------

export function parseInlineMarkdown(text) {
    const placeholders = [];
    const ph = (html) => {
        const token = `\x00MD${placeholders.length}\x00`;
        placeholders.push({ token, html });
        return token;
    };

    let src = String(text || '');

    // 1. Protect code spans — must come first so code content isn't parsed
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

    // 5. Apply inline formatting (order matters!)
    // Bold + Italic: ***text*** or ___text___
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_ (with boundary awareness to avoid false matches)
    html = html.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    html = html.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    // Strikethrough: ~~text~~
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

    // 6. Restore placeholders
    placeholders.forEach(({ token, html: replacement }) => {
        html = html.replaceAll(token, replacement);
    });

    return html;
}

// -----------------------------------------------------------------------------
// Block-level Detection (for paragraph boundary checking)
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Main Markdown → HTML Converter
// -----------------------------------------------------------------------------

export function markdownToHtml(markdown) {
    const normalized = String(markdown || '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) return '';

    const lines = normalized.split('\n');
    const htmlParts = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Empty line — skip
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
            if (i < lines.length) i++; // skip closing ```
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
                i += 2; // skip header + separator
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

        // --- Task Lists: - [ ] or - [x] ---
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

        // --- Paragraphs (default) ---
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

// -----------------------------------------------------------------------------
// Content Normalization (for storage)
// -----------------------------------------------------------------------------

export function normalizeStoredContent(content) {
    const raw = typeof content === 'string' ? content : '';
    if (!raw.trim()) return '';
    // Only convert markdown→HTML if content is plain text with markdown patterns
    if (!isProbablyHtml(raw) && looksLikeMarkdown(raw)) {
        return markdownToHtml(raw);
    }
    return sanitizeHtml(raw);
}

// -----------------------------------------------------------------------------
// Timestamp Formatting (shared utility)
// -----------------------------------------------------------------------------

export function formatTimestamp(isoString, includeTime = false) {
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
