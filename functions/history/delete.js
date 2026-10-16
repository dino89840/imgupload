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
    const row = await withD1Retry(() =>
      DB.prepare("SELECT r2_key FROM history WHERE id = ?").bind(id).first()
    );

    if (row && row.r2_key) {
      // R2 ထဲက ဖိုင်ကိုလည်း ဖျက်ပါ
      await MY_BUCKET.delete(row.r2_key);
    }

    // D1 ထဲကလည်း ဖျက်ပါ
    await withD1Retry(() =>
      DB.prepare("DELETE FROM history WHERE id = ?").bind(id).run()
    );

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

// D1 transient-error retry: Cloudflare D1 က transient error
// ("Network connection lost" စသည်) ပေးတတ်ပြီး write query တွေကို
// သူ့အလိုလို retry မပေးလို့ app က ကိုယ်တိုင် retry ရပါတယ်။
const TRANSIENT_PATTERNS = [
  "network connection lost",
  "transient",
  "timeout",
  "reset",
  "overloaded",
  "cannot resolve d1",
];
const RETRY_DELAYS_MS = [100, 300, 700]; // attempts 2, 3, 4 မတိုင်ခင် စောင့်ချိန်

function isTransientError(err) {
  const message = String(err?.message || err || "").toLowerCase();
  return TRANSIENT_PATTERNS.some((pattern) => message.includes(pattern));
}

async function withD1Retry(fn) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt === 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}
