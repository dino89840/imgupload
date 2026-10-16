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

    const result = await withD1Retry(() =>
      DB.prepare(
        "SELECT id, public_url, file_name, r2_key, created_at FROM history ORDER BY created_at DESC LIMIT 50"
      ).all()
    );

    return new Response(JSON.stringify({ items: result.results || [] }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ items: [], error: e.message }), {
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
