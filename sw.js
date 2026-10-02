// Service worker: viser push-notifikationer fra edge function "push".

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data.json();
  } catch (_error) {
    data = {};
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Next Level MC", {
      body: data.body || "",
      icon: "/assets/icons/icon-192.png",
      tag: data.tag,
      data: { url: data.url || "/member/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/member/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => client.url === url);
      return open ? open.focus() : self.clients.openWindow(url);
    })
  );
});
