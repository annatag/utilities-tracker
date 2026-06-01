export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.TRACKER_BACKUPS;
  const url = new URL(request.url);

  async function getData() {
    let data = await kv.get("data", "json");

    // Seed from public/data.json ONLY ONCE
    if (!data) {
      const seedResponse = await fetch(
        `${url.origin}/data.json`
      );

      data = await seedResponse.json();

      await kv.put("data", JSON.stringify(data));
    }

    return data;
  }

  async function saveData(data) {
    await kv.put("data", JSON.stringify(data));
  }

  // GET ALL
  if (url.pathname === "/api/items" && request.method === "GET") {
    return Response.json(await getData());
  }

  // CREATE
  if (url.pathname === "/api/items" && request.method === "POST") {
    const body = await request.json();
    const data = await getData();

    const item = {
      id: Date.now(),
      ...body
    };

    data.push(item);

    await saveData(data);

    return Response.json(item);
  }

  // UPDATE
  if (url.pathname.startsWith("/api/items/") && request.method === "PUT") {
    const id = Number(url.pathname.split("/").pop());
    const body = await request.json();

    const data = await getData();
    const index = data.findIndex(i => i.id === id);

    if (index === -1) {
      return new Response("Not found", { status: 404 });
    }

    data[index] = { ...data[index], ...body };

    await saveData(data);

    return Response.json(data[index]);
  }

  // DELETE
  if (url.pathname.startsWith("/api/items/") && request.method === "DELETE") {
    const id = Number(url.pathname.split("/").pop());

    let data = await getData();

    data = data.filter(i => i.id !== id);

    await saveData(data);

    return Response.json({ success: true });
  }

  return new Response("Not found", { status: 404 });
}
