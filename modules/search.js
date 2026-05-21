// =============================================================================
// modules/search.js — Search Parsing, Filtering, Highlighting
// =============================================================================

import { escapeHtml, getPlainTextFromHtml } from './markdown.js';

// -----------------------------------------------------------------------------
// Regex Escaping
// -----------------------------------------------------------------------------

export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// -----------------------------------------------------------------------------
// Query Parsing
// -----------------------------------------------------------------------------

/**
 * Parses a search query into structured tokens.
 * Supports: "exact phrase", +required, -excluded, normal words
 * @returns {Array<{text: string, type: string}>}
 */
export function parseSearchQuery(query) {
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

// -----------------------------------------------------------------------------
// Search Execution
// -----------------------------------------------------------------------------

/**
 * Searches notes by query. Returns matching notes sorted by relevance score.
 * Title matches score higher than content matches.
 */
export function performSearch(notes, query) {
    const tokens = parseSearchQuery(query);
    if (!tokens.length) return notes;

    return notes
        .map(note => {
            const titleText = note.title.toLowerCase();
            const contentText = getPlainTextFromHtml(note.content).toLowerCase();

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
                    // Ignore regex construction errors
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

// -----------------------------------------------------------------------------
// Highlight Helpers
// -----------------------------------------------------------------------------

/**
 * Extracts positive search terms from a query for highlighting.
 * Terms are sorted longest-first for correct regex matching.
 */
export function getHighlightTerms(query) {
    return parseSearchQuery(query)
        .filter(t => t.type !== 'excluded' && t.text)
        .map(t => t.text)
        .sort((a, b) => b.length - a.length);
}

/**
 * Highlights matching terms in plain text by wrapping them in <span> tags.
 * The input text is escaped for HTML safety.
 */
export function highlightMatchesInText(text, terms) {
    const value = String(text || '');
    if (!terms.length) return escapeHtml(value);

    const pattern = terms.map(escapeRegExp).join('|');
    if (!pattern) return escapeHtml(value);

    const regex = new RegExp(pattern, 'gi');
    let result = '';
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(value)) !== null) {
        result += escapeHtml(value.slice(lastIndex, match.index));
        result += `<span class="highlight-match">${escapeHtml(match[0])}</span>`;
        lastIndex = regex.lastIndex;
        // Guard against zero-length matches
        if (regex.lastIndex === match.index) regex.lastIndex++;
    }

    result += escapeHtml(value.slice(lastIndex));
    return result;
}
