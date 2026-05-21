// =============================================================================
// modules/store.js — Note CRUD, localStorage, Import/Export
// =============================================================================

import {
    normalizeStoredContent,
    isValidDateString,
    sanitizeHtml,
    getPlainTextFromHtml
} from './markdown.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Note Validation & Migration
// -----------------------------------------------------------------------------

export function validateNote(note) {
    let changed = false;
    if (!note.id) {
        note.id = generateId();
        changed = true;
    }
    if (!isValidDateString(note.timestamp)) {
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
    const normalized = normalizeStoredContent(note.content);
    if (normalized !== note.content) {
        note.content = normalized;
        changed = true;
    }
    return { note, changed };
}

// -----------------------------------------------------------------------------
// Load & Save
// -----------------------------------------------------------------------------

export function loadNotesFromStorage() {
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

export function saveNotesToStorage(notes) {
    try {
        localStorage.setItem('notes', JSON.stringify(notes));
    } catch (error) {
        console.error('Failed to save notes:', error);
    }
}

// -----------------------------------------------------------------------------
// Note Creation
// -----------------------------------------------------------------------------

export function createNewNote() {
    return {
        id: generateId(),
        title: '',
        content: '',
        timestamp: new Date().toISOString()
    };
}

// -----------------------------------------------------------------------------
// Note Update (fixes duplicate-save bug from original)
// -----------------------------------------------------------------------------

/**
 * Updates a note in the array and reorders if needed.
 * Returns { notes, newActiveIndex } or null if nothing changed.
 */
export function updateNoteInArray(notes, activeIndex, newTitle, newContent) {
    if (activeIndex === null || activeIndex >= notes.length) return null;

    const note = notes[activeIndex];
    const contentChanged = note.title !== newTitle || note.content !== newContent;

    if (!contentChanged) return null;

    note.title = newTitle;
    note.content = newContent;
    note.timestamp = new Date().toISOString();

    let newActiveIdx = activeIndex;

    // Move updated note to top if not already there
    if (activeIndex !== 0) {
        notes.splice(activeIndex, 1);
        notes.unshift(note);
        newActiveIdx = 0;
    }

    // Single save (fixes the double-save bug)
    saveNotesToStorage(notes);

    return { notes, newActiveIndex: newActiveIdx };
}

// -----------------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------------

export function exportAllNotesAsJson(notes) {
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

export function exportNoteAsText(note) {
    if (!note) return false;
    try {
        const title = note.title || 'Untitled';
        const text = getPlainTextFromHtml(note.content);
        const content = `Title: ${note.title}\n\n---\n\n${text}`;
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, `${title.replace(/[^a-z0-9 _-]/gi, '_')}.txt`);
        return true;
    } catch (error) {
        console.error('Export note failed:', error);
        return false;
    }
}

// -----------------------------------------------------------------------------
// Import
// -----------------------------------------------------------------------------

export function importNotesFromFile(file, existingNotes) {
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
                        content: normalizeStoredContent(n.content),
                        timestamp: isValidDateString(n.timestamp) ? n.timestamp : new Date().toISOString()
                    }));

                const invalidCount = toImport.length - valid.length;

                if (valid.length === 0) {
                    reject(new Error(
                        toImport.length > 0 ? 'No valid notes found in the file.' : 'File contains no notes.'
                    ));
                    return;
                }

                // Merge, avoiding duplicates by ID
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
