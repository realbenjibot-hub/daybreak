/* Daybreak reminder sender — runs hourly in GitHub Actions.
   GitHub's cron is UTC and DST-unaware, so we run every hour and gate on the
   actual America/New_York local hour here. That keeps reminders at the right
   local time year-round (no spring/fall drift).

   Secrets (set as GitHub Actions repo secrets):
     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — the keypair
     VAPID_SUBJECT                        — mailto: address (optional)
     PUSH_SUBSCRIPTION                    — one subscription object, or a JSON array of them
*/
const webpush = require("web-push");

const PUB = process.env.VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:tim@gardnercr.com";
const SUBS_RAW = (process.env.PUSH_SUBSCRIPTION || "").trim();
const FORCE = (process.env.FORCE_REMINDER || "").trim(); // manual test: "7" | "16" | "19" | "22"

if (!PUB || !PRIV) { console.error("Missing VAPID keys — nothing to do."); process.exit(0); }
if (!SUBS_RAW) { console.error("No PUSH_SUBSCRIPTION set yet — nobody to notify."); process.exit(0); }

webpush.setVapidDetails(SUBJECT, PUB, PRIV);

let subs;
try {
  const parsed = JSON.parse(SUBS_RAW);
  subs = Array.isArray(parsed) ? parsed : [parsed];
} catch (e) {
  console.error("PUSH_SUBSCRIPTION is not valid JSON.");
  process.exit(1);
}

// Eastern-time hour (0–23), DST-correct via Intl.
function etHour() {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
  // Intl can return "24" at midnight in some environments — normalize.
  return parseInt(fmt.format(new Date()), 10) % 24;
}

// hour (ET) -> reminder payload
const REMINDERS = {
  7:  { tag: "morning", title: "☀️ Boot the day",  body: "Wake up, log your sleep, set your Big 3. Let's go, Caden." },
  16: { tag: "workout", title: "⚡ Did you move today?", body: "Get the run or lift in before the day gets away from you." },
  19: { tag: "meals",   title: "🍽️ Log your meals", body: "Cross off breakfast, lunch, dinner, snack." },
  22: { tag: "bedtime", title: "🌙 Wind down",     body: "Tap the moon when you get in bed. Eight hours starts now." }
};

const hour = FORCE !== "" ? (parseInt(FORCE, 10) % 24) : etHour();
const r = REMINDERS[hour];
if (!r) { console.log("No reminder scheduled for ET hour " + hour + "."); process.exit(0); }

(async () => {
  const payload = JSON.stringify({ title: r.title, body: r.body, tag: r.tag, url: "./" });
  let ok = 0;
  let expired = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      ok++;
    } catch (err) {
      console.error("push failed (" + (err.statusCode || "?") + "):", err.body || err.message);
      if (err.statusCode === 404 || err.statusCode === 410) expired++;
    }
  }
  console.log("Reminder '" + r.tag + "' sent to " + ok + "/" + subs.length + " subscription(s)" +
    (expired ? " (" + expired + " expired — re-enable on that device)" : "") + ".");
})();
