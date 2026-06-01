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
  const body = await request.json();
  const data = await getData();

  const item = {
  id: crypto.randomUUID(),
  ...body
  };

  data.data.items.push(item);

  await saveData(data);

  return Response.json(item);

  // UPDATE
   const items = data.data.items;

  const index = items.findIndex(i => i.id === id);

  items[index] = {
  ...items[index],
  ...body
  };

  // DELETE
  data.data.items =
  data.data.items.filter(i => i.id !== id);

  return new Response("Not found", { status: 404 });
}
