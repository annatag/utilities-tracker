const DATA_KEY = "data";
const SENT_KEY_PREFIX = "notification-sent";
const KV_BINDING_NAME = "TRACKER_BACKUPS";
const RESEND_API_URL = "https://api.resend.com/emails";
const NOTIFICATION_RECIPIENTS = [
  { name: "Anna", email: "annagoranova17@gmail.com" },
  { name: "Lubo", email: "liubomirm@gmail.com" }
];
const REMINDER_DAYS_BEFORE_DUE = 2;
const REMINDER_ITEM_LABEL = "utility bill, finance item, or credit card due date";
const REMINDER_ITEM_LABEL_PLURAL = "utility bills, finance items, or credit card due dates";

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

function isUnpaidStatus(status) {
  return status !== "paid" && status !== "inactive" && status !== "closed";
}

function isPaidInSameMonth(paidDate, dueDate) {
  return /^\d{4}-\d{2}-/.test(String(paidDate || "")) && String(paidDate).slice(0, 7) === String(dueDate || "").slice(0, 7);
}

function isUnpaidMonthlyStatus(status, paidDate, dueDate) {
  if (status === "inactive" || status === "closed") return false;
  if (status === "paid") return !isPaidInSameMonth(paidDate, dueDate);
  return true;
}

function dueDateForMonthlyDay(day, targetDate) {
  const dayNumber = Math.min(Math.max(Number(day || 1), 1), 28);
  const [, , targetDay] = String(targetDate || "").split("-").map(Number);
  return targetDay === dayNumber ? targetDate : "";
}

function financeReminderItem({ id, title, subtitle, amount, dueDate, account = "" }) {
  return {
    id,
    category: "Finance",
    title,
    subtitle,
    amount: Number(amount || 0),
    dueDate,
    account
  };
}

function financeReminderItems(data, targetDate) {
  const houses = new Map((data.houses || []).map(house => {
    const normalized = normalizeHouseRecord(house);
    return [normalized.id, normalized];
  }));
  const items = [];

  for (const finance of data.finance || []) {
    if (!finance || !finance.houseId) continue;
    const houseName = houseDisplayName(houses.get(finance.houseId));

    const mortgageDue = dueDateForMonthlyDay(finance.mortgageDueDay, targetDate);
    if (finance.mortgageVisible !== "no" && mortgageDue && isUnpaidMonthlyStatus(finance.mortgagePaid, finance.mortgagePaidDate, mortgageDue)) {
      items.push(financeReminderItem({
        id: `${finance.houseId}-mortgage-${mortgageDue}`,
        title: "Mortgage",
        subtitle: [houseName, finance.mortgageCompany, finance.mortgageNumber].filter(Boolean).join(" · "),
        amount: finance.mortgageAmount,
        dueDate: mortgageDue,
        account: finance.mortgageNumber || ""
      }));
    }

    const salesDue = dueDateForMonthlyDay(finance.salesDueDay, targetDate);
    if (finance.salesVisible !== "no" && salesDue && isUnpaidMonthlyStatus(finance.salesPaid, finance.salesPaidDate, salesDue)) {
      items.push(financeReminderItem({
        id: `${finance.houseId}-sales-tax-${salesDue}`,
        title: "Florida Sales Tax",
        subtitle: [houseName, finance.salesAgency, finance.salesFiled].filter(Boolean).join(" · "),
        amount: Number(finance.salesTaxable || 0) * 0.06,
        dueDate: salesDue
      }));
    }

    const touristDue = dueDateForMonthlyDay(finance.touristDueDay, targetDate);
    if (finance.touristVisible !== "no" && touristDue && isUnpaidMonthlyStatus(finance.touristPaid, finance.touristPaidDate, touristDue)) {
      items.push(financeReminderItem({
        id: `${finance.houseId}-tourist-tax-${touristDue}`,
        title: "Tourist Tax",
        subtitle: [houseName, finance.touristAgency, finance.touristFiled].filter(Boolean).join(" · "),
        amount: Number(finance.touristTaxable || 0) * 0.06,
        dueDate: touristDue
      }));
    }

    if (finance.insuranceVisible !== "no" && isUnpaidStatus(finance.insurancePaid) && finance.insuranceDue === targetDate) {
      items.push(financeReminderItem({
        id: `${finance.houseId}-hazardous-insurance-${finance.insuranceDue}`,
        title: "Hazardous Insurance",
        subtitle: [houseName, finance.insuranceCompany, finance.insurancePolicyNumber].filter(Boolean).join(" · "),
        amount: finance.insuranceAmount,
        dueDate: finance.insuranceDue,
        account: finance.insurancePolicyNumber || ""
      }));
    }

    if (finance.propertyTaxVisible !== "no" && isUnpaidStatus(finance.propertyTaxPaid) && finance.propertyTaxDue === targetDate) {
      items.push(financeReminderItem({
        id: `${finance.houseId}-property-tax-${finance.propertyTaxDue}`,
        title: "Property Taxes",
        subtitle: [houseName, finance.propertyTaxAgency].filter(Boolean).join(" · "),
        amount: finance.propertyTaxAmount,
        dueDate: finance.propertyTaxDue
      }));
    }
  }

  for (const item of data.financeItems || []) {
    if (!item || item.due !== targetDate || !isUnpaidStatus(item.paid)) continue;
    items.push(financeReminderItem({
      id: item.id || `${item.houseId}-${item.name}-${item.due}`,
      title: item.name || "Finance item",
      subtitle: [houseDisplayName(houses.get(item.houseId)), item.company, item.account].filter(Boolean).join(" · "),
      amount: item.amount,
      dueDate: item.due,
      account: item.account || ""
    }));
  }

  return items;
}

function buildReminderItems(data, todayISO) {
  const targetDate = addDaysISO(todayISO, REMINDER_DAYS_BEFORE_DUE);
  return [
    ...utilityReminderItems(data, targetDate),
    ...financeReminderItems(data, targetDate),
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
  const counts = items.reduce((all, item) => ({ ...all, [item.category]: (all[item.category] || 0) + 1 }), {});
  const parts = [];
  if (counts.Utility) parts.push(`${counts.Utility} utility bill${counts.Utility === 1 ? "" : "s"}`);
  if (counts.Finance) parts.push(`${counts.Finance} finance item${counts.Finance === 1 ? "" : "s"}`);
  if (counts["Credit card"]) parts.push(`${counts["Credit card"]} credit card due date${counts["Credit card"] === 1 ? "" : "s"}`);
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
      <p>The following ${items.length === 1 ? REMINDER_ITEM_LABEL : REMINDER_ITEM_LABEL_PLURAL} are due in ${REMINDER_DAYS_BEFORE_DUE} days, on <strong>${escapeHtml(formatISODate(targetDate))}</strong>.</p>
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
    `The following ${items.length === 1 ? REMINDER_ITEM_LABEL : REMINDER_ITEM_LABEL_PLURAL} are due in ${REMINDER_DAYS_BEFORE_DUE} days, on ${formatISODate(targetDate)}.`,
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

function requestNotificationToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const bearerToken = authorization.replace(/^Bearer\s+/i, "");
  return bearerToken || request.headers.get("X-Notification-Secret") || "";
}

function validateNotificationAuth(request, env) {
  if (!env.NOTIFICATION_SECRET) {
    return {
      ok: false,
      status: 500,
      body: {
        success: false,
        sent: false,
        error: "NOTIFICATION_SECRET is not configured in Cloudflare Pages.",
        troubleshooting: "Add a Cloudflare Pages environment variable named exactly NOTIFICATION_SECRET, then redeploy. This must match the GitHub Actions repository secret with the same name."
      }
    };
  }

  const token = requestNotificationToken(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      body: {
        success: false,
        sent: false,
        error: "Missing notification secret header.",
        troubleshooting: "Send Authorization: Bearer YOUR_NOTIFICATION_SECRET, or X-Notification-Secret, from GitHub Actions or curl."
      }
    };
  }

  if (token !== env.NOTIFICATION_SECRET) {
    return {
      ok: false,
      status: 401,
      body: {
        success: false,
        sent: false,
        error: "Notification secret does not match Cloudflare Pages configuration.",
        troubleshooting: "Make the GitHub Actions NOTIFICATION_SECRET repository secret exactly match the Cloudflare Pages NOTIFICATION_SECRET environment variable, then rerun the workflow."
      }
    };
  }

  return { ok: true };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const auth = validateNotificationAuth(request, env);
  if (!auth.ok) {
    return jsonResponse(auth.body, { status: auth.status });
  }

  try {
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
      return jsonResponse({ success: true, sent: false, today, targetDate, checkedItemTypes: ["Utility", "Finance", "Credit card"], message: "No unsent due date reminders found." });
    }

    if (dryRun) {
      return jsonResponse({ success: true, dryRun: true, sent: false, today, targetDate, recipients: NOTIFICATION_RECIPIENTS, items });
    }

    const emailResult = await sendReminderEmail(env, NOTIFICATION_RECIPIENTS, items, targetDate);
    await markItemsSent(env, items, NOTIFICATION_RECIPIENTS);

    return jsonResponse({ success: true, sent: true, today, targetDate, recipients: NOTIFICATION_RECIPIENTS, itemCount: items.length, emailResult });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        sent: false,
        error: error && error.message ? error.message : "Notification request failed.",
        troubleshooting: "Check Cloudflare Pages environment variables, the TRACKER_BACKUPS KV binding, Resend configuration, and GitHub Actions logs."
      },
      { status: 500 }
    );
  }
}

export async function onRequestGet() {
  return jsonResponse(
    { error: "Use POST to send due date notifications." },
    { status: 405, headers: { Allow: "POST" } }
  );
}
