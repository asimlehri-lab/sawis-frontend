// SAWIS service worker -- browser push only. It does NOT do offline caching.
// It exists so the browser has a registered service worker to attach a
// PushManager subscription to, and to handle the two push-related events
// below. "Install as an app" (manifest + icons, see src/InstallApp.tsx) does
// not depend on this file. Kept deliberately minimal; real offline support
// is a separate, later project.

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
      icon: "/icon-192.png",
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
