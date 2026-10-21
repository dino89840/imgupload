// functions/files/[[name]].js

export async function onRequestGet(
  context
) {
  const { MY_BUCKET } =
    context.env;

  const request =
    context.request;

  const cache =
    caches.default;

  const cacheKey =
    new Request(
      request.url,
      {
        method: "GET"
      }
    );

  const cachedResponse =
    await cache.match(cacheKey);

  if (cachedResponse) {
    // Edge cache ထဲက ပုံနဲ့ ETag ကိုက်ရင် body မပို့ဘဲ 304 ပြန်မယ်။
    const cachedEtag = cachedResponse.headers.get("ETag");

    if (
      cachedEtag &&
      request.headers.get("If-None-Match") === cachedEtag
    ) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: cachedEtag,
          "Cache-Control": cachedResponse.headers.get("Cache-Control"),
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    return cachedResponse;
  }

  const nameParts =
    context.params.name;

  const fileName =
    Array.isArray(nameParts)
      ? nameParts.join("/")
      : String(nameParts || "");

  if (!fileName) {
    return new Response(
      "Not Found",
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  try {
    const object =
      await MY_BUCKET.get(fileName);

    if (!object) {
      return new Response(
        "File Not Found",
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store"
          }
        }
      );
    }

    const headers =
      new Headers();

    object.writeHttpMetadata(
      headers
    );

    headers.set(
      "Content-Type",
      object.httpMetadata
        ?.contentType ||
        "application/octet-stream"
    );

    headers.set(
      "Cache-Control",
      object.httpMetadata
        ?.cacheControl ||
        "public, max-age=31536000, immutable"
    );

    headers.set(
      "Access-Control-Allow-Origin",
      "*"
    );

    headers.set(
      "Cross-Origin-Resource-Policy",
      "cross-origin"
    );

    headers.set(
      "X-Content-Type-Options",
      "nosniff"
    );

    if (object.httpEtag) {
      headers.set(
        "ETag",
        object.httpEtag
      );
    }

    headers.set(
      "Content-Length",
      String(object.size)
    );

    // ETag ကိုက်တဲ့ revalidation ဆိုရင် body မပို့ဘဲ 304 ပြန်မယ်
    // (browser/edge cache က ရှိပြီးသား ပုံကို ပြန်သုံးမယ်)။
    if (
      object.httpEtag &&
      request.headers.get("If-None-Match") === object.httpEtag
    ) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: object.httpEtag,
          "Cache-Control": headers.get("Cache-Control"),
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    const response =
      new Response(
        object.body,
        {
          status: 200,
          headers
        }
      );

    context.waitUntil(
      cache.put(
        cacheKey,
        response.clone()
      )
    );

    return response;
  } catch (error) {
    console.error(
      "R2 read error:",
      error
    );

    return new Response(
      "Error retrieving file",
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
