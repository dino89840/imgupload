// POST /upload
export async function onRequestPost(context) {
  const { MY_BUCKET, DB } = context.env;

  try {
    if (!DB) {
      return new Response(JSON.stringify({ error: "DB binding မရှိပါ" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const formData = await context.request.formData();
    const file = formData.get("file");

    if (!file) {
      return new Response(JSON.stringify({ error: "No file" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Unique filename ဖန်တီးခြင်း (UUID ထည့်ထားလို့ ဘယ်တော့မှ မထပ်နိုင်)
    const timestamp = Date.now();
    const uuid = crypto.randomUUID();
    const ext = getExtension(file.name, file.type);
    const fileName = `${timestamp}_${uuid}.${ext}`;

    // R2 သို့ Upload
    const arrayBuffer = await file.arrayBuffer();
    await MY_BUCKET.put(fileName, arrayBuffer, {
      httpMetadata: {
        contentType: file.type || "image/jpeg",
      },
    });

    // Public URL ဖန်တီးခြင်း
    const origin = new URL(context.request.url).origin;
    const publicUrl = `${origin}/files/${fileName}`;

    // History D1 ထဲ သိမ်းခြင်း
    const id = `${timestamp}_${uuid}`;
    const historyItem = {
      id,
      public_url: publicUrl,
      file_name: file.name,
      r2_key: fileName,
      created_at: new Date().toISOString(),
    };

    // INSERT OR IGNORE + retry: D1 transient error ("Network connection lost"
    // စသည်) မှာ ပထမ attempt တကယ် ဝင်သွားပြီး response ပဲ ပျက်သွားရင်
    // retry က PK error မဖြစ်ဘဲ no-op ဖြစ်မယ်။
    // Transient error အကုန်ပျက်ရင်လည်း ဖိုင်က R2 ထဲ ရှိနေပြီမို့
    // URL ကို ပြန်ပေးမယ် (fail-soft) — History row ပဲ ပျောက်မယ်။
    // Non-transient error (schema စသည်) ဆိုရင်တော့ 500 ပဲ ပြမယ်။
    let historyError = false;
    try {
      await withD1Retry(() =>
        DB.prepare(
          "INSERT OR IGNORE INTO history (id, public_url, file_name, r2_key, created_at) VALUES (?, ?, ?, ?, ?)"
        )
          .bind(
            historyItem.id,
            historyItem.public_url,
            historyItem.file_name,
            historyItem.r2_key,
            historyItem.created_at
          )
          .run()
      );
    } catch (err) {
      if (isTransientError(err)) {
        historyError = true;
      } else {
        throw err;
      }
    }

    const body = historyError
      ? { url: publicUrl, history_error: true }
      : { url: publicUrl };

    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function getExtension(name, type) {
  const fromName = name.split(".").pop();
  if (fromName && fromName !== name) return fromName;
  const map = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  return map[type] || "jpg";
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
