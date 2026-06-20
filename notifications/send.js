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

// hour (ET) -> crude nag. The cron runs hourly; only these slots fire, so 11 PM–7 AM
// stays quiet. Each slot has a few lines that rotate daily so it isn't the same roast.
const SLOTS = {
  8:  { tag: "wake",    title: "☀️ Boot up, chud", lines: [
        "Up. Log your sleep, set your Big 3, quit wasting daylight.",
        "Morning wood's got more ambition than you. Tap the sun and move.",
        "You're not tired, you're undisciplined. Boot the day." ] },
  10: { tag: "am-move", title: "⚡ Move, chud", lines: [
        "Two hours up and nothing logged? The run won't run itself.",
        "Get the cardio in before your excuses warm up.",
        "Heart rate of a houseplant. Go get it up." ] },
  12: { tag: "fuel",    title: "🍽️ Eat, chud", lines: [
        "It's noon. Eat something real and cross off a meal.",
        "Fuel isn't optional. Log breakfast and lunch, you gremlin.",
        "Running on cope and caffeine again? Eat. Log it." ] },
  14: { tag: "pm-move", title: "⚡ Still nothing?", lines: [
        "Half the day gone, chud. Run or lift — pick one and do it.",
        "Your to-do list is collecting dust. So are your shoes.",
        "Edged your whole afternoon away. Go sweat instead." ] },
  16: { tag: "lift",    title: "🏋️ Lift, chud", lines: [
        "Did you lift, or just lift excuses today?",
        "The bar's lonely. Go put it to use.",
        "Strength session or another nap, chud? Choose violence." ] },
  18: { tag: "dinner",  title: "🍽️ Fuel check", lines: [
        "Dinner's a meal, not a personality. Eat and log it.",
        "Cross off your meals before you forget you're a human.",
        "Protein, chud. Not just vibes." ] },
  20: { tag: "big3",    title: "🎯 Big 3 — done?", lines: [
        "Big 3 finished, or coasting again, chud?",
        "Three things. THREE. Knock them out before bed.",
        "All talk today? Prove it — close out your Big 3." ] },
  22: { tag: "bed",     title: "🌙 Wind down", lines: [
        "Tap the moon and sleep before you doomscroll into oblivion.",
        "Bed, chud. Eight hours starts the second you stop scrolling.",
        "Lights out. Tomorrow's you is begging you not to stay up." ] }
};

const hour = FORCE !== "" ? (parseInt(FORCE, 10) % 24) : etHour();
const slot = SLOTS[hour];
if (!slot) { console.log("No nag scheduled for ET hour " + hour + " (quiet hours)."); process.exit(0); }

// rotate the line daily (and offset by hour) so the same one doesn't repeat
const etDayIndex = Math.floor(new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).getTime() / 86400000);
const r = { tag: slot.tag, title: slot.title, body: slot.lines[(etDayIndex + hour) % slot.lines.length] };

(async () => {
  const payload = JSON.stringify({ title: r.title, body: r.body, tag: "daybreak", url: "./" });
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
