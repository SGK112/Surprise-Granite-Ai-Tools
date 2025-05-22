self.addEventListener('install', event => {
    event.waitUntil(
        caches.open('granite-quote-v2').then(cache => {
            return cache.addAll([
                '/',
                '/manifest.json',
                '/dist/output.css',
                '/js/app.js',
                '/images/fallback.jpg'
            ]);
        })
    );
});

self.addEventListener('activate', event => {
    const cacheWhitelist = ['granite-quote-v2'];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (!cacheWhitelist.includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request).then(fetchResponse => {
                if (event.request.url.includes('/countertop_images/')) {
                    caches.open('granite-quote-v2').then(cache => {
                        cache.put(event.request, fetchResponse.clone());
                    });
                }
                return fetchResponse;
            });
        }).catch(() => {
            if (event.request.url.includes('/countertop_images/')) {
                return caches.match('/images/fallback.jpg');
            }
        })
    );
});
