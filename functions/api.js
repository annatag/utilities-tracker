export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const kv = env.TRACKER_BACKUPS;

    async function getData() {
      return (await kv.get("data", "json")) || [];
    }

    async function saveData(data) {
      await kv.put("data", JSON.stringify(data));
    }

    // READ
    if (url.pathname === "/api/items" && request.method === "GET") {
      return Response.json(await getData());
    }

    // CREATE
    if (url.pathname === "/api/items" && request.method === "POST") {
      const body = await request.json();
      const data = await getData();

      const newItem = { id: Date.now(), ...body };
      data.push(newItem);

      await saveData(data);
      return Response.json(newItem);
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

    return new Response("API running");
  }
};
