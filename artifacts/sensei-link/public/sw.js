self.addEventListener("push", function (event) {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Sproutly", body: event.data.text() };
  }

  const title = payload.title || "Sproutly";
  const options = {
    body: payload.body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const rawUrl = event.notification.data?.url || "/";
  // Build absolute URL so client.url comparison works (client.url is always absolute)
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        // Focus an existing tab that is already on the target page
        for (const client of clientList) {
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }
        }
        // If any tab is open on this origin, navigate it to the target URL
        for (const client of clientList) {
          if ("navigate" in client) {
            client.focus();
            return client.navigate(targetUrl);
          }
        }
        // No open tab — open a new window
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      }),
  );
});
