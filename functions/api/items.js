export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.TRACKER_BACKUPS;
  const url = new URL(request.url);

  async function getData() {
    let data = await kv.get("data", "json");

    // Seed from data.json ONLY ONCE
    if (!data) {
      const seedResponse = await fetch(`${url.origin}/data.json`);
      data = await seedResponse.json();

      await kv.put("data", JSON.stringify(data));
    }

    return data;
  }

  async function saveData(data) {
    await kv.put("data", JSON.stringify(data));
  }

  // ================= GET =================
  if (url.pathname === "/api/items" && request.method === "GET") {
    return Response.json(await getData());
  }

  if (url.pathname === "/api/items" && request.method === "POST") {

  const body = await request.json();

  // overwrite full app state
  await saveData(body);

  return Response.json({
    success: true
  });
}

  // ================= UPDATE =================
  if (url.pathname.startsWith("/api/items/") && request.method === "PUT") {
    const id = url.pathname.split("/").pop();

    const body = await request.json();
    const data = await getData();

    const items = data.data.items;

    const index = items.findIndex(i => i.id === id);

    if (index === -1) {
      return new Response("Not found", { status: 404 });
    }

    items[index] = {
      ...items[index],
      ...body
    };

    await saveData(data);

    return Response.json(items[index]);
  }

  // ================= DELETE =================
  if (url.pathname.startsWith("/api/items/") && request.method === "DELETE") {
    const id = url.pathname.split("/").pop();

    const data = await getData();

    data.data.items =
      data.data.items.filter(i => i.id !== id);

    await saveData(data);

    return Response.json({ success: true });
  }

  return new Response("Not found", { status: 404 });
}
