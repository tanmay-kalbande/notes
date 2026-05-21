# Enhanced macOS Notes

A sleek, offline-capable note-taking web application with a macOS-inspired interface. Built with vanilla HTML, CSS, and modern JavaScript (ES Modules) — zero dependencies, instant load.

## Features

- **Rich Text Editing** — Bold, italic, underline, strikethrough, headings, lists, blockquotes, and more via toolbar or keyboard shortcuts
- **Full Markdown Support** — Headings, bold, italic, strikethrough, inline code, code blocks, links, images, tables, task lists (checkboxes), blockquotes, ordered/unordered lists, horizontal rules
- **Smart Auto-Formatting** — Type markdown syntax and it converts to rich text automatically (programmatic, no AI required)
- **Live Markdown Shortcuts** — Type `#` + Space for headings, `-` + Space for bullets, `1.` + Space for numbered lists, `>` + Space for blockquotes
- **AI Note Enhancer** — Optional Gemini API integration for formatting enhancement, summarization, grammar fixing, and action item extraction
- **Dark & Light Mode** — Toggle between themes with persistent preference
- **Advanced Search** — Full-text search with support for `"exact phrases"`, `+required`, and `-excluded` terms
- **Import/Export** — Export all notes as JSON, export individual notes as text, import from JSON backups
- **Offline Support** — Service worker caches the app for offline use
- **Responsive Design** — Works on desktop and mobile with a collapsible sidebar
- **Resizable Sidebar** — Drag to resize the sidebar width (desktop)
- **Local Storage** — All notes are saved locally in your browser

## Tech Stack

- **HTML5** — Semantic markup
- **CSS3** — Custom properties, flexbox, grid, animations
- **JavaScript (ES Modules)** — Modern modular architecture with zero external dependencies
- **Service Worker** — Offline caching with cache-first strategy

## Project Structure

```
├── index.html              # Main HTML page
├── styles.css              # All styles
├── app.js                  # Main application orchestrator
├── modules/
│   ├── markdown.js         # Markdown parser & HTML sanitizer
│   ├── store.js            # Note CRUD & localStorage
│   ├── search.js           # Search engine
│   ├── editor.js           # Rich text editor
│   ├── ui.js               # UI rendering & interactions
│   └── ai.js               # AI enhancer (Gemini API)
├── service-worker.js       # Offline support
├── manifest.json           # PWA manifest
├── env.example.js          # API key template
└── resources/
    └── favicon.png         # App icon
```

## Setup

1. Clone the repository
2. Copy `env.example.js` to `env.js` and add your Gemini API key (optional — only needed for AI features)
3. Serve the files with any static server, or open `index.html` directly in a browser

## License

© 2025 Tanmay Kalbande
