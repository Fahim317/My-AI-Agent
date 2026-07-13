// sw.js — Turjo v3 (vibration + requireInteraction + morning briefing)
// CACHE version bumped to v3 — forces old cache to clear on all devices

const CACHE = "agent-shell-v3";
const SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ||
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
    )
  );
});

// ── Push notification handler ──
self.addEventListener("push", (event) => {
  let data = { title: "Turjo", body: "New notification." };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const title = data.title || "Turjo";
  const body  = data.body  || "";

  // Detect type for different vibration patterns
  const isReminder = title.toLowerCase().includes("reminder");
  const isMorning  = title.toLowerCase().includes("morning") ||
                     title.toLowerCase().includes("good morning") ||
                     title.toLowerCase().includes("shubho");

  // Reminder  → urgent: double-buzz then long hold
  // Morning   → gentle wave: soft-soft-medium
  // Default   → signature Turjo: short-pause-short-pause-long
  const vibrate = isReminder
    ? [250, 80, 250, 80, 700, 120, 700]
    : isMorning
    ? [150, 120, 150, 120, 400]
    : [300, 100, 200, 100, 500];

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:             "/icon-192.png",
      badge:            "/icon-192.png",
      vibrate,
      requireInteraction: true,   // stays on screen until user acts
      renotify:           true,   // vibrate even if same tag
      timestamp:          Date.now(),
      actions: [
        { action: "open",    title: "Open Turjo" },
        { action: "dismiss", title: "Dismiss"    },
      ],
    })
  );
});

// ── Notification click ──
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) { if ("focus" in c) return c.focus(); }
        if (self.clients.openWindow) return self.clients.openWindow("/");
      })
  );
});
