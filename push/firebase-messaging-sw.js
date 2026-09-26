/* The worker that shows a notification when the app is not on screen.
 *
 * In a directory of its own, and that is the whole reason this file is not
 * where FCM's documentation puts it. A service worker's scope is the folder
 * it is served from, and registering a second script at the app's own scope
 * *replaces* the first — so `firebase-messaging-sw.js` beside the app would
 * quietly take over from `daily_service_worker.js` and the PWA would stop
 * being cached. Under `push/` the two never meet: delivery does not care
 * about scope, only registration does.
 *
 * No Firebase SDK in here either. The SDK's worker exists to turn a message
 * into a notification, and the raw `push` event already carries everything
 * needed to do that — importing 200KB from a CDN to read one JSON body would
 * be a second thing that can fail offline.
 */

/* The payload FCM delivers is not quite the one the server sent: depending
 * on the path it took, the link is under `fcmOptions`, or `fcm_options`, or
 * folded into `notification.click_action`. All three are read, because a
 * notification that opens nothing is worse than no notification.
 */
function linkIn(payload) {
  var options = payload.fcmOptions || payload.fcm_options || {};
  var notification = payload.notification || {};
  var link = options.link || notification.click_action || '';
  return ours(link) ? link : '';
}

/* Whether a link points back into this app.
 *
 * The only thing that can send a notification here is our own server, and it
 * already refuses a link outside the app (`requireOurLink` in
 * `mcp/src/push/route.ts`). This is the second lock, on the side that opens
 * the window: a notification wearing our name and opening somebody else's
 * page is exactly the shape of a phishing link, and it should take two
 * mistakes to make one instead of one.
 *
 * The app is the directory above this worker — whatever origin it is served
 * from — so there is nothing hardcoded here to keep in step with a deploy.
 */
function ours(link) {
  if (!link) return false;
  try {
    var root = new URL('../', self.registration.scope).href;
    return new URL(link, root).href.indexOf(root) === 0;
  } catch (e) {
    return false;
  }
}

self.addEventListener('push', function (event) {
  if (!event.data) return;
  var payload;
  try {
    payload = event.data.json();
  } catch (e) {
    return;
  }
  var notification = payload.notification || {};
  var title = notification.title || 'Daily';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: notification.body || '',
      icon: '../icons/Icon-192.png',
      badge: '../icons/Icon-192.png',
      // One notification per post rather than a pile: the second comment on
      // the same post replaces the first instead of stacking under it.
      tag: linkIn(payload) || title,
      renotify: true,
      data: { link: linkIn(payload) },
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var link = (event.notification.data && event.notification.data.link) || '';
  if (!link) return;
  /* `matchAll` only sees clients inside this worker's scope, and the app is
   * outside it — so there is no open tab to focus from here and a new window
   * is the honest answer. On an installed app that is the app itself.
   */
  event.waitUntil(self.clients.openWindow(link));
});
