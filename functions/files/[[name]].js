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
        status: 404
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
          status: 404
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
        status: 500
      }
    );
  }
}
