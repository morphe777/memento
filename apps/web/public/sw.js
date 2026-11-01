// Minimal service worker: makes the PWA installable; network-first, no API caching (data must stay fresh).
// Web Push (user request 01/11/2026): shows the notification, a tap opens (or focuses) Mémento on its page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', (e) => {
  let msg = { title: 'Mémento', body: '', url: '/semaine' };
  try {
    msg = { ...msg, ...e.data.json() };
  } catch {
    if (e.data) msg.body = e.data.text();
  }
  e.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: msg.url },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/semaine', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(self.location.origin));
      if (win) return win.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : w));
      return self.clients.openWindow(url);
    }),
  );
});
