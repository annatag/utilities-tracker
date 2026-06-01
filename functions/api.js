export async function onRequestGet(context) {
  const kv = context.env.TRACKER_BACKUPS;

  // Check if KV already has data
  let data = await kv.get("data", "json");

  // If empty → seed from local JSON
  if (!data) {
    const seed = await fetch(new URL("../public/data.json", import.meta.url));
    data = await seed.json();

    await kv.put("data", JSON.stringify(data));
  }

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" }
  });
}
