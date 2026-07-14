// sw.js — Turjo v3
// CACHE bumped to v3 — clears old cache on all devices automatically

const CACHE = "agent-shell-v3";
const SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
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
  if (new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ||
      fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
    )
  );
});

// ── Push notification ──
self.addEventListener("push", (event) => {
  let data = { title: "Turjo", body: "New notification." };
  try { if (event.data) data = event.data.json(); }
  catch (e) { if (event.data) data.body = event.data.text(); }

  const title = data.title || "Turjo";
  const body  = data.body  || "";

  // Different vibration for different notification types
  const isReminder = title.toLowerCase().includes("reminder");
  const isMorning  = title.toLowerCase().includes("morning") || title.toLowerCase().includes("shubho");

  const vibrate = isReminder
    ? [300, 100, 300, 100, 700, 150, 700]   // urgent double-buzz for reminders
    : isMorning
    ? [200, 100, 200, 100, 400]              // gentle wave for morning briefing
    : [300, 100, 200, 100, 500];             // signature Turjo pattern

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:               "/icon-192.png",
      badge:              "/icon-192.png",
      vibrate,
      requireInteraction: true,   // stays on screen until user acts
      renotify:           true,   // always vibrate even with same tag
      tag:                "turjo",
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
