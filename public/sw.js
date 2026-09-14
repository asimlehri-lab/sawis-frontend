// SAWIS service worker — Phase 6 (browser push) only. This file does NOT do
// offline caching or a PWA install prompt; it exists purely so the browser
// has a registered service worker to attach a PushManager subscription to,
// and to handle the two push-related events below. Kept deliberately
// minimal on purpose — a real offline/PWA story is a separate, later
// project (see the project handoff: "a real installable mobile app is a
// separate, later project").

self.addEventListener("push", (event) => {
  let data = { title: "SAWIS", body: "You have a new notification." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Payload wasn't JSON -- fall back to the default text above instead of
    // letting the whole push event fail silently with no notification at all.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.svg",
      tag: data.tag || "sawis-notification",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => "focus" in c);
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    })
  );
});
