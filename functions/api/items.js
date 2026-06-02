const DATA_KEY = "data";

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
  return env && env.TRACKER_BACKUPS;
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = getKvNamespace(env);
  const url = new URL(request.url);

  if (url.pathname !== "/api/items" || !["GET", "POST"].includes(request.method)) {
    return new Response("Not found", { status: 404 });
  }

  async function loadSeedData() {
    const seedResponse = await fetch(`${url.origin}/data.json`, { cache: "no-store" });

    if (!seedResponse.ok) {
      throw new Error("Could not load seed data.json");
    }

    return seedResponse.json();
  }

  if (!kv) {
    if (request.method === "GET") {
      const data = await loadSeedData();
      return jsonResponse({
        ...data,
        cloudStorageConfigured: false,
        warning: "Cloud storage is not configured. Showing public/data.json without shared saving."
      });
    }

    return jsonResponse(
      {
        error: "Cloud storage is not configured. Add a TRACKER_BACKUPS KV binding to this Cloudflare Pages project."
      },
      { status: 503 }
    );
  }

  async function getData() {
    let data = await kv.get(DATA_KEY, "json");

    // Seed from data.json only once, when the KV namespace is empty.
    if (!data) {
      data = await loadSeedData();
      await kv.put(DATA_KEY, JSON.stringify(data));
    }

    return data;
  }

  async function saveData(data) {
    await kv.put(DATA_KEY, JSON.stringify(data));
  }

  if (request.method === "GET") {
    return jsonResponse(await getData());
  }

  const body = await request.json();

  if (!body || typeof body !== "object" || !body.data || typeof body.data !== "object") {
    return jsonResponse({ error: "Expected a full tracker state wrapper with a data object." }, { status: 400 });
  }

  await saveData({
    ...body,
    app: body.app || "House Maintenance Utilities Contacts Finance Tracker",
    updatedAt: new Date().toISOString()
  });

  return jsonResponse({ success: true });
}
