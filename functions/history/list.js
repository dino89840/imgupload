// GET /history/list
export async function onRequestGet(context) {
  const { DB } = context.env;

  try {
    if (!DB) {
      return new Response(
        JSON.stringify({ items: [], error: "DB binding မရှိပါ" }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const result = await DB.prepare(
      "SELECT id, public_url, file_name, r2_key, created_at FROM history ORDER BY created_at DESC LIMIT 50"
    ).all();

    return new Response(JSON.stringify({ items: result.results || [] }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ items: [], error: e.message }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
