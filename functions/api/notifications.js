const DATA_KEY = "data";
const SENT_KEY_PREFIX = "notification-sent";
const KV_BINDING_NAME = "TRACKER_BACKUPS";
const RESEND_API_URL = "https://api.resend.com/emails";
const NOTIFICATION_RECIPIENTS = [
  { name: "Anna", email: "annagoranova17@gmail.com" },
  { name: "Lubo", email: "liubomirm@gmail.com" }
];
const REMINDER_DAYS_BEFORE_DUE = 2;

function jsonResponse(body, init = {}) {
  return Response.json(body, {
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {})
    },
    ...init
  });
}

function getKvNamespace(env) {
  return env && env[KV_BINDING_NAME];
}

function isoDateFromParts(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function addDaysISO(isoDate, days) {
  const [year, month, day] = String(isoDate || "").split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function formatISODate(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function unwrapTrackerData(source) {
  return source && typeof source === "object" && source.data && typeof source.data === "object" ? source.data : source;
}

async function loadSeedData(url) {
  const seedResponse = await fetch(`${url.origin}/data.json`, { cache: "no-store" });

  if (!seedResponse.ok) {
    throw new Error("Could not load seed data.json");
  }

  return seedResponse.json();
}

async function getTrackerData(env, url) {
  const kv = getKvNamespace(env);
  if (!kv) return unwrapTrackerData(await loadSeedData(url));

  let data = await kv.get(DATA_KEY, "json");
  if (!data) {
    data = await loadSeedData(url);
    await kv.put(DATA_KEY, JSON.stringify(data));
  }

  return unwrapTrackerData(data);
}

function normalizeHouseRecord(house) {
  if (!house || typeof house !== "object") return { id: "", nickname: "", name: "", address: "" };
  if (!house.nickname && !house.address) {
    house.nickname = house.name || "";
    house.address = house.name || "";
  }
  return house;
}

function houseDisplayName(house) {
  if (!house) return "";
  return house.nickname || house.name || "Unnamed house";
}

function parseFlexibleDueDate(value, todayISO) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const today = new Date(`${todayISO}T00:00:00Z`);
  const fallbackYear = today.getUTCFullYear();
  const monthMatch = raw.match(/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{1,2}))?(?:,?\s+(\d{4}))?$/i);

  if (monthMatch) {
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = monthNames.findIndex(name => monthMatch[1].toLowerCase().startsWith(name));
    const day = Number(monthMatch[2] || 1);
    const explicitYear = monthMatch[3] ? Number(monthMatch[3]) : null;
    let parsed = isoDateFromParts(explicitYear || fallbackYear, monthIndex, day);

    if (parsed && !explicitYear && parsed < todayISO) {
      parsed = isoDateFromParts(fallbackYear + 1, monthIndex, day);
    }

    return parsed;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function utilityReminderItems(data, targetDate) {
  const houses = new Map((data.houses || []).map(house => {
    const normalized = normalizeHouseRecord(house);
    return [normalized.id, normalized];
  }));

  return (data.utilities || [])
    .filter(utility => utility && utility.paid !== "paid" && utility.paid !== "inactive" && utility.due === targetDate)
    .map(utility => ({
      id: utility.id || `${utility.houseId}-${utility.type}-${utility.due}`,
      category: "Utility",
      title: utility.type || "Utility bill",
      subtitle: [houseDisplayName(houses.get(utility.houseId)), utility.provider].filter(Boolean).join(" · "),
      amount: Number(utility.amount || 0),
      dueDate: utility.due,
      account: utility.account || ""
    }));
}

function creditCardReminderItems(data, targetDate, todayISO) {
  return (data.creditCards || [])
    .filter(card => card && card.status !== "closed")
    .map(card => ({ card, dueDate: parseFlexibleDueDate(card.dueDate, todayISO) }))
    .filter(({ dueDate }) => dueDate === targetDate)
    .map(({ card, dueDate }) => ({
      id: card.id || `${card.bank}-${card.name}-${card.last4}-${dueDate}`,
      category: "Credit card",
      title: [card.bank, card.name].filter(Boolean).join(" ") || "Credit card",
      subtitle: [card.owner, card.type, card.last4 ? `•••• ${card.last4}` : "", card.businessName].filter(Boolean).join(" · "),
      amount: Number(card.annualFee || 0),
      dueDate,
      account: card.last4 || ""
    }));
}

function buildReminderItems(data, todayISO) {
  const targetDate = addDaysISO(todayISO, REMINDER_DAYS_BEFORE_DUE);
  return [
    ...utilityReminderItems(data, targetDate),
    ...creditCardReminderItems(data, targetDate, todayISO)
  ];
}

function sentKeyForItem(item, recipientEmail) {
  return `${SENT_KEY_PREFIX}:${item.dueDate}:${item.category}:${item.id}:${recipientEmail}`;
}

async function filterUnsentItems(env, items, recipients, force = false) {
  const kv = getKvNamespace(env);
  if (!kv || force) return items;

  const pending = [];
  for (const item of items) {
    const sentFlags = await Promise.all(recipients.map(recipient => kv.get(sentKeyForItem(item, recipient.email))));
    if (sentFlags.some(flag => !flag)) pending.push(item);
  }
  return pending;
}

function buildEmailSubject(items, targetDate) {
  const utilityCount = items.filter(item => item.category === "Utility").length;
  const creditCardCount = items.filter(item => item.category === "Credit card").length;
  const parts = [];
  if (utilityCount) parts.push(`${utilityCount} utility bill${utilityCount === 1 ? "" : "s"}`);
  if (creditCardCount) parts.push(`${creditCardCount} credit card due date${creditCardCount === 1 ? "" : "s"}`);
  return `Reminder: ${parts.join(" and ")} due ${formatISODate(targetDate)}`;
}

function buildEmailHtml(items, targetDate) {
  const rows = items.map(item => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>${escapeHtml(item.category)}</strong></td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.title)}<br><span style="color:#6b7280;">${escapeHtml(item.subtitle)}</span></td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${item.amount ? escapeHtml(money(item.amount)) : ""}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(formatISODate(item.dueDate))}</td>
    </tr>`).join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.45;">
      <h2 style="margin-bottom:8px;">Utilities Tracker reminder</h2>
      <p>The following utilities or credit card due dates are due in ${REMINDER_DAYS_BEFORE_DUE} days, on <strong>${escapeHtml(formatISODate(targetDate))}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;max-width:760px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px;text-align:left;">Type</th>
            <th style="padding:8px;text-align:left;">Item</th>
            <th style="padding:8px;text-align:right;">Amount / fee</th>
            <th style="padding:8px;text-align:left;">Due</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#6b7280;font-size:12px;margin-top:16px;">This automated reminder was sent ${REMINDER_DAYS_BEFORE_DUE} days before the due date.</p>
    </div>`;
}

function buildEmailText(items, targetDate) {
  const lines = [
    "Utilities Tracker reminder",
    `The following utilities or credit card due dates are due in ${REMINDER_DAYS_BEFORE_DUE} days, on ${formatISODate(targetDate)}.`,
    ""
  ];

  for (const item of items) {
    lines.push(`- ${item.category}: ${item.title}${item.subtitle ? ` (${item.subtitle})` : ""}${item.amount ? ` — ${money(item.amount)}` : ""} — due ${formatISODate(item.dueDate)}`);
  }

  return lines.join("\n");
}

async function sendReminderEmail(env, recipients, items, targetDate) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  if (!env.NOTIFICATION_FROM_EMAIL) {
    throw new Error("NOTIFICATION_FROM_EMAIL is not configured.");
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.NOTIFICATION_FROM_EMAIL,
      to: recipients.map(recipient => recipient.email),
      subject: buildEmailSubject(items, targetDate),
      html: buildEmailHtml(items, targetDate),
      text: buildEmailText(items, targetDate)
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || `Resend API failed with ${response.status}`);
  }
  return result;
}

async function markItemsSent(env, items, recipients) {
  const kv = getKvNamespace(env);
  if (!kv) return;

  const expiryTtl = 60 * 60 * 24 * 400;
  await Promise.all(items.flatMap(item => recipients.map(recipient =>
    kv.put(sentKeyForItem(item, recipient.email), new Date().toISOString(), { expirationTtl: expiryTtl })
  )));
}

function requestIsAuthorized(request, env) {
  if (!env.NOTIFICATION_SECRET) return false;
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  return token === env.NOTIFICATION_SECRET || request.headers.get("X-Notification-Secret") === env.NOTIFICATION_SECRET;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!requestIsAuthorized(request, env)) {
    return jsonResponse({ error: "Unauthorized notification request." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const today = body.today || url.searchParams.get("today") || new Date().toISOString().slice(0, 10);
  const dryRun = body.dryRun === true || url.searchParams.get("dryRun") === "true";
  const force = body.force === true || url.searchParams.get("force") === "true";
  const targetDate = addDaysISO(today, REMINDER_DAYS_BEFORE_DUE);

  if (!targetDate) {
    return jsonResponse({ error: "Invalid today date. Use YYYY-MM-DD." }, { status: 400 });
  }

  const data = await getTrackerData(env, url);
  const allDueItems = buildReminderItems(data, today);
  const items = await filterUnsentItems(env, allDueItems, NOTIFICATION_RECIPIENTS, force);

  if (!items.length) {
    return jsonResponse({ success: true, sent: false, today, targetDate, message: "No unsent utility or credit card due date reminders found." });
  }

  if (dryRun) {
    return jsonResponse({ success: true, dryRun: true, sent: false, today, targetDate, recipients: NOTIFICATION_RECIPIENTS, items });
  }

  const emailResult = await sendReminderEmail(env, NOTIFICATION_RECIPIENTS, items, targetDate);
  await markItemsSent(env, items, NOTIFICATION_RECIPIENTS);

  return jsonResponse({ success: true, sent: true, today, targetDate, recipients: NOTIFICATION_RECIPIENTS, itemCount: items.length, emailResult });
}

export async function onRequestGet() {
  return jsonResponse(
    { error: "Use POST to send due date notifications." },
    { status: 405, headers: { Allow: "POST" } }
  );
}
