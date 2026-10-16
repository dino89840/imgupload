// POST /history/delete
export async function onRequestPost(context) {
  const { MY_BUCKET, DB } = context.env;

  try {
    if (!DB) {
      return new Response(JSON.stringify({ error: "DB binding မရှိပါ" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await context.request.json();
    const id = body.id;

    // D1 ထဲက history data ဖတ်ပါ (R2 key ပါပါတယ်)
    const row = await DB.prepare("SELECT r2_key FROM history WHERE id = ?")
      .bind(id)
      .first();

    if (row && row.r2_key) {
      // R2 ထဲက ဖိုင်ကိုလည်း ဖျက်ပါ
      await MY_BUCKET.delete(row.r2_key);
    }

    // D1 ထဲကလည်း ဖျက်ပါ
    await DB.prepare("DELETE FROM history WHERE id = ?").bind(id).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
