// POST /internal/upload
//
// Authorization:
// Bearer <IMPORT_API_KEY>
//
// Required environment bindings:
// MY_BUCKET
// IMPORT_API_KEY
// PUBLIC_FILE_BASE_URL
//
// PUBLIC_FILE_BASE_URL example:
// https://your-image-domain.com/files

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (
      !env.IMPORT_API_KEY ||
      !env.PUBLIC_FILE_BASE_URL
    ) {
      return json(
        {
          error:
            "IMPORT_API_KEY သို့မဟုတ် PUBLIC_FILE_BASE_URL မသတ်မှတ်ရသေးပါ"
        },
        500
      );
    }

    if (!env.MY_BUCKET) {
      return json(
        { error: "MY_BUCKET binding မရှိပါ" },
        500
      );
    }

    const authorization =
      request.headers.get("authorization") || "";

    const expectedAuthorization =
      `Bearer ${env.IMPORT_API_KEY}`;

    const authorized = await secureCompare(
      authorization,
      expectedAuthorization
    );

    if (!authorized) {
      return json(
        { error: "Unauthorized" },
        401
      );
    }

    const contentType =
      request.headers.get("content-type") || "";

    if (
      !contentType
        .toLowerCase()
        .includes("multipart/form-data")
    ) {
      return json(
        { error: "multipart/form-data လိုအပ်ပါသည်" },
        400
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const rawKind = String(
      formData.get("kind") || "image"
    );

    if (
      !file ||
      typeof file.arrayBuffer !== "function"
    ) {
      return json(
        { error: "Image file မပါပါ" },
        400
      );
    }

    const mimeType = String(
      file.type || ""
    ).toLowerCase();

    const extensionMap = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/avif": "avif"
    };

    if (!extensionMap[mimeType]) {
      return json(
        {
          error:
            "JPG, PNG, WEBP သို့မဟုတ် AVIF ပုံသာ လက်ခံပါသည်"
        },
        400
      );
    }

    const maximumSize =
      10 * 1024 * 1024;

    if (
      Number(file.size || 0) >
      maximumSize
    ) {
      return json(
        { error: "ပုံဖိုင်သည် 10 MB ထက်ကြီးနေပါသည်" },
        413
      );
    }

    const kind =
      rawKind
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 30) || "image";

    const extension =
      extensionMap[mimeType];

    const uniqueName =
      `${Date.now()}_${crypto.randomUUID()}.${extension}`;

    const objectKey =
      `tmdb/${kind}/${uniqueName}`;

    const arrayBuffer =
      await file.arrayBuffer();

    await env.MY_BUCKET.put(
      objectKey,
      arrayBuffer,
      {
        httpMetadata: {
          contentType: mimeType,
          cacheControl:
            "public, max-age=31536000, immutable"
        },
        customMetadata: {
          source: "movie-website",
          kind
        }
      }
    );

    const publicBase =
      String(env.PUBLIC_FILE_BASE_URL)
        .trim()
        .replace(/\/+$/, "");

    return json({
      ok: true,
      key: objectKey,
      url: `${publicBase}/${objectKey}`
    });
  } catch (error) {
    console.error("Internal upload error:", error);

    return json(
      {
        error:
          error?.message ||
          "R2 upload မအောင်မြင်ပါ"
      },
      500
    );
  }
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    }
  );
}

async function secureCompare(left, right) {
  const encoder = new TextEncoder();

  const [leftHash, rightHash] =
    await Promise.all([
      crypto.subtle.digest(
        "SHA-256",
        encoder.encode(String(left))
      ),
      crypto.subtle.digest(
        "SHA-256",
        encoder.encode(String(right))
      )
    ]);

  const leftBytes =
    new Uint8Array(leftHash);

  const rightBytes =
    new Uint8Array(rightHash);

  let difference =
    leftBytes.length ^ rightBytes.length;

  const length = Math.max(
    leftBytes.length,
    rightBytes.length
  );

  for (let index = 0; index < length; index++) {
    difference |=
      (leftBytes[index] || 0) ^
      (rightBytes[index] || 0);
  }

  return difference === 0;
}
