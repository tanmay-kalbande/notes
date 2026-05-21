// Service Worker for Enhanced macOS Notes v2.0
const CACHE_NAME = 'notes-pro-cache-v2.0';

// Core app shell files
const APP_SHELL_FILES = [
    '.',
    'index.html',
    'styles.css',
    'app.js',
    'modules/markdown.js',
    'modules/store.js',
    'modules/search.js',
    'modules/editor.js',
    'modules/ui.js',
    'modules/ai.js',
    'manifest.json',
    'resources/favicon.png'
];

// External resources — cached opportunistically, won't block install
const OPTIONAL_CACHE_FILES = [
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

const ALL_CACHE_FILES = [...APP_SHELL_FILES, ...OPTIONAL_CACHE_FILES];

// --- Installation ---
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing v2.0...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching App Shell Files');
                return cache.addAll(APP_SHELL_FILES)
                    .then(() => Promise.allSettled(
                        OPTIONAL_CACHE_FILES.map(file => cache.add(file))
                    ));
            })
            .then(() => {
                console.log('[Service Worker] Installation successful.');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('[Service Worker] Caching failed during install:', error);
            })
    );
});

// --- Activation ---
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating v2.0...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[Service Worker] Claiming clients.');
            return self.clients.claim();
        })
    );
});

// --- Fetch Interception (Cache-First for App Shell) ---
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
        return;
    }

    const requestUrl = new URL(event.request.url);

    // Check if this request is for an app shell file
    const isAppShellRequest = ALL_CACHE_FILES.some(fileUrl => {
        if (fileUrl === '.') {
            return requestUrl.pathname === '/' || requestUrl.pathname.endsWith('/index.html');
        }
        try {
            const cacheFileUrl = new URL(fileUrl, self.location.origin);
            return requestUrl.href === cacheFileUrl.href;
        } catch {
            return requestUrl.pathname.endsWith('/' + fileUrl) || requestUrl.pathname === '/' + fileUrl;
        }
    });

    if (isAppShellRequest) {
        // Cache-First strategy for app shell
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(event.request).then(networkResponse => {
                    if (!networkResponse || networkResponse.status !== 200 ||
                        (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {
                        return networkResponse;
                    }
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                    return networkResponse;
                });
            }).catch(error => {
                console.error('[Service Worker] Fetch error:', error);
            })
        );
    }
    // Non-shell requests pass through to the network
});
