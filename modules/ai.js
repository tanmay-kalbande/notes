// =============================================================================
// modules/ai.js — AI Note Enhancer (Gemini API)
// =============================================================================

import { markdownToHtml } from './markdown.js';

// -----------------------------------------------------------------------------
// Module State
// -----------------------------------------------------------------------------

let aiModal, aiEnhanceBtn, aiCancelBtn, aiSubmitBtn, aiAcceptBtn;
let geminiApiKeyInput, toggleApiKeyVisibilityBtn;
let aiPreviewSection, aiPreviewContent, aiLoadingEl;
let aiOptButtons;

let selectedAiAction = 'enhance';
let enhancedTextResult = '';

// Callbacks
let getEditorPlainText = () => '';
let getMainViewState = () => 'placeholder';
let getActiveNoteIndex = () => null;
let onApplyEnhancement = () => {};
let showNotification = () => {};

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

export function initAiEnhancer(config) {
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

    // Load saved API key
    const savedKey = localStorage.getItem('gemini_api_key') || '';
    if (geminiApiKeyInput) {
        geminiApiKeyInput.value = savedKey;
    }

    // Toggle API key visibility
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

    // Open modal
    aiEnhanceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (getMainViewState() !== 'editor' || getActiveNoteIndex() === null) {
            showNotification('Please select a note to enhance first.', true);
            return;
        }

        // Prefill env key if available
        const envKey = (window.env && window.env.GEMINI_API_KEY) || '';
        if (envKey && envKey !== 'YOUR_GEMINI_API_KEY_HERE' && geminiApiKeyInput) {
            if (!geminiApiKeyInput.value) {
                geminiApiKeyInput.value = envKey;
            }
        }

        // Reset modal state
        aiPreviewSection.style.display = 'none';
        aiPreviewContent.innerHTML = '';
        aiAcceptBtn.style.display = 'none';
        aiSubmitBtn.style.display = 'inline-block';
        aiLoadingEl.style.display = 'none';

        aiModal.classList.add('show');
    });

    // Close modal
    aiCancelBtn.addEventListener('click', closeModal);
    aiModal.querySelector('.close-modal-btn').addEventListener('click', closeModal);

    // Option selection
    aiOptButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            aiOptButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedAiAction = btn.dataset.action;
        });
    });

    // Save key on input
    if (geminiApiKeyInput) {
        geminiApiKeyInput.addEventListener('input', () => {
            localStorage.setItem('gemini_api_key', geminiApiKeyInput.value.trim());
        });
    }

    // Submit enhancement request
    aiSubmitBtn.addEventListener('click', runAiEnhancement);

    // Apply enhanced result
    aiAcceptBtn.addEventListener('click', () => {
        if (!enhancedTextResult) return;
        onApplyEnhancement(enhancedTextResult);
        closeModal();
        showNotification('AI enhancements applied successfully!');
    });
}

// -----------------------------------------------------------------------------
// Modal Control
// -----------------------------------------------------------------------------

function closeModal() {
    if (aiModal) aiModal.classList.remove('show');
}

// -----------------------------------------------------------------------------
// AI Enhancement Request
// -----------------------------------------------------------------------------

async function runAiEnhancement() {
    // Resolve API key: prefer env.js, fall back to user input
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

    // Show loading state
    aiLoadingEl.style.display = 'flex';
    aiPreviewSection.style.display = 'none';
    aiSubmitBtn.style.display = 'none';

    // Build prompt based on selected action
    const prompts = {
        enhance: `You are a professional Markdown and rich text enhancer. Convert the following notes into clean, beautiful, properly structured Markdown. Use headings (# for title, ## for sections, ### for subsections) where logical. Group items into bulleted or ordered lists where appropriate. If data looks structured, create a clean Markdown table with alignments. Retain ALL existing information. ONLY return the enhanced Markdown text, do not include any introductory or concluding conversational filler:\n\n${noteText}`,
        summarize: `You are a professional text summarizer. Create a concise, structured summary of the following notes. Use bold text for key terms and a clean bulleted list for major takeaways and action points. Retain the core meaning. ONLY return the summary in Markdown format, without any conversational preamble:\n\n${noteText}`,
        grammar: `You are an expert copyeditor. Fix any grammatical, spelling, punctuation, or stylistic errors in the following text. Make it flow naturally and read professionally while keeping the original meaning and tone intact. Use clean Markdown formatting. ONLY return the polished Markdown text, without any conversational preamble:\n\n${noteText}`,
        todo: `You are a productivity assistant. Analyze the following notes and extract all action items, tasks, and follow-ups. Format them as a clean, structured to-do list using Markdown checkboxes (e.g. - [ ] Task name). If there are no clear tasks, formulate logical action steps based on the note's contents. ONLY return the Markdown task list, without any conversational preamble:\n\n${noteText}`
    };

    const prompt = prompts[selectedAiAction] || prompts.enhance;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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

        // Clean up markdown fencing if present
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

        // Convert to HTML and show preview
        enhancedTextResult = markdownToHtml(cleaned);
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
