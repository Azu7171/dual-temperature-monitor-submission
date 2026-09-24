self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function safePath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Temperature alert", {
      body: payload.body || "A temperature threshold was crossed.",
      icon: "/thermometer-icon.svg",
      badge: "/thermometer-icon.svg",
      tag: payload.tag || "temperature-alert",
      data: { url: safePath(payload.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePath(event.notification.data?.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && "navigate" in client) {
          return client.navigate(url).then((windowClient) => windowClient?.focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
