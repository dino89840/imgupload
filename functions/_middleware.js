const COOKIE_NAME = "img_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  /*
   * Public image URLs
   *
   * /files/example.jpg ကို password မလိုဘဲ
   * မည်သူမဆို ကြည့်နိုင်ပါမယ်။
   */
  if (pathname === "/files" || pathname.startsWith("/files/")) {
    return context.next();
  }

  /*
   * Login page
   */
  if (pathname === "/login") {
    if (request.method === "GET") {
      return handleLoginPage(context);
    }

    if (request.method === "POST") {
      return handleLogin(context);
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, POST",
      },
    });
  }

  /*
   * Logout
   */
  if (pathname === "/logout") {
    return handleLogout(request);
  }

  /*
   * Cloudflare secret ရှိ/မရှိ စစ်ခြင်း
   */
  if (!env.SITE_PASSWORD) {
    return configurationError();
  }

  /*
   * Login cookie မှန်/မမှန် စစ်ခြင်း
   */
  const authenticated = await isAuthenticated(
    request,
    env.SITE_PASSWORD
  );

  if (!authenticated) {
    return unauthorizedResponse(request);
  }

  /*
   * Login ဝင်ထားပြီးသားဆိုရင် မူလ request ကို ဆက်သွားစေမယ်။
   * Protected pages/API တွေကို browser cache မသိမ်းစေပါ။
   */
  const response = await context.next();
  const headers = new Headers(response.headers);

  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleLoginPage(context) {
  const { request, env } = context;

  if (!env.SITE_PASSWORD) {
    return configurationError();
  }

  /*
   * Login ဝင်ပြီးသားဆိုရင် home page ကိုပြန်ပို့မယ်။
   */
  if (await isAuthenticated(request, env.SITE_PASSWORD)) {
    return Response.redirect(new URL("/", request.url), 302);
  }

  return loginPage();
}

async function handleLogin(context) {
  const { request, env } = context;

  if (!env.SITE_PASSWORD) {
    return configurationError();
  }

  try {
    const formData = await request.formData();
    const enteredPassword = String(formData.get("password") || "");

    const passwordCorrect = await secureStringCompare(
      enteredPassword,
      String(env.SITE_PASSWORD)
    );

    if (!passwordCorrect) {
      return loginPage("Password မှားနေပါတယ်။", 401);
    }

    /*
     * Password ကို cookie ထဲတိုက်ရိုက်မသိမ်းပါ။
     * Password ကနေထုတ်ထားတဲ့ SHA-256 token ကိုသာ သိမ်းပါမယ်။
     */
    const sessionToken = await createSessionToken(
      String(env.SITE_PASSWORD)
    );

    const redirectUrl = new URL("/", request.url);

    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl.toString(),
        "Set-Cookie": createSessionCookie(
          sessionToken,
          request,
          SESSION_MAX_AGE
        ),
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    return loginPage("Login ပြုလုပ်၍မရပါ။ ထပ်မံကြိုးစားပါ။", 400);
  }
}

function handleLogout(request) {
  const redirectUrl = new URL("/login", request.url);

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl.toString(),
      "Set-Cookie": createSessionCookie("", request, 0),
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

async function isAuthenticated(request, password) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const receivedToken = cookies[COOKIE_NAME];

  if (!receivedToken) {
    return false;
  }

  const expectedToken = await createSessionToken(password);

  return secureStringCompare(receivedToken, expectedToken);
}

async function createSessionToken(password) {
  const data = new TextEncoder().encode(
    `cloudfare-img-session:${password}`
  );

  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/*
 * Timing differences မဖြစ်အောင် value နှစ်ခုလုံးကို
 * SHA-256 လုပ်ပြီး constant-time ပုံစံနဲ့ နှိုင်းယှဉ်ပါတယ်။
 */
async function secureStringCompare(valueA, valueB) {
  const encoder = new TextEncoder();

  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest(
      "SHA-256",
      encoder.encode(String(valueA))
    ),
    crypto.subtle.digest(
      "SHA-256",
      encoder.encode(String(valueB))
    ),
  ]);

  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);

  let difference = 0;

  for (let i = 0; i < bytesA.length; i++) {
    difference |= bytesA[i] ^ bytesB[i];
  }

  return difference === 0;
}

function parseCookies(cookieHeader) {
  const cookies = {};

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (!name) {
      continue;
    }

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
}

function createSessionCookie(value, request, maxAge) {
  const url = new URL(request.url);

  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
  ];

  /*
   * Production HTTPS မှာ Secure ထည့်မယ်။
   * localhost HTTP testing လုပ်ရင် cookie အလုပ်လုပ်နိုင်အောင်
   * HTTP မှာ Secure မထည့်ထားပါ။
   */
  if (url.protocol === "https:") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

function unauthorizedResponse(request) {
  const accepts = request.headers.get("Accept") || "";

  /*
   * Normal browser page request ဆိုရင် login page ဆီပို့မယ်။
   */
  if (request.method === "GET" && accepts.includes("text/html")) {
    const loginUrl = new URL("/login", request.url);

    return Response.redirect(loginUrl, 302);
  }

  /*
   * Upload/history API request ဆိုရင် JSON 401 ပြန်မယ်။
   */
  return new Response(
    JSON.stringify({
      error: "Unauthorized",
      message: "Password ဖြည့်ပြီး login ဝင်ပါ။",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "private, no-store, max-age=0",
      },
    }
  );
}

function configurationError() {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuration Error</title>
</head>
<body style="font-family: sans-serif; padding: 30px;">
  <h2>Configuration Error</h2>
  <p>Cloudflare မှာ <code>SITE_PASSWORD</code> secret မထည့်ရသေးပါ။</p>
</body>
</html>`,
    {
      status: 500,
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "private, no-store, max-age=0",
      },
    }
  );
}

function loginPage(errorMessage = "", status = 200) {
  const safeError = escapeHtml(errorMessage);

  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>Login - R2 Image Uploader</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: #f8fafc;
      color: #334155;
      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Roboto,
        sans-serif;
    }

    .login-card {
      width: 100%;
      max-width: 380px;
      padding: 28px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow:
        0 10px 25px rgba(15, 23, 42, 0.08);
    }

    .icon {
      width: 54px;
      height: 54px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      border-radius: 50%;
      background: #eef2ff;
      font-size: 26px;
    }

    h1 {
      margin: 0;
      color: #0f172a;
      text-align: center;
      font-size: 23px;
    }

    .description {
      margin: 8px 0 24px;
      color: #64748b;
      text-align: center;
      font-size: 14px;
    }

    label {
      display: block;
      margin-bottom: 7px;
      color: #475569;
      font-size: 13px;
      font-weight: 600;
    }

    input {
      width: 100%;
      padding: 13px;
      border: 1px solid #cbd5e1;
      border-radius: 9px;
      outline: none;
      font: inherit;
    }

    input:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
    }

    button {
      width: 100%;
      margin-top: 16px;
      padding: 13px;
      border: 0;
      border-radius: 9px;
      background: #6366f1;
      color: #ffffff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    button:hover {
      background: #4f46e5;
    }

    .error {
      margin-bottom: 16px;
      padding: 11px;
      border: 1px solid #fecaca;
      border-radius: 8px;
      background: #fef2f2;
      color: #dc2626;
      text-align: center;
      font-size: 13px;
    }
  </style>
</head>

<body>
  <main class="login-card">
    <div class="icon">🔒</div>

    <h1>R2 Image Uploader</h1>

    <p class="description">
      ဆက်လက်အသုံးပြုရန် password ဖြည့်ပါ။
    </p>

    ${safeError ? `<div class="error">${safeError}</div>` : ""}

    <form method="POST" action="/login">
      <label for="password">Password</label>

      <input
        type="password"
        id="password"
        name="password"
        placeholder="Enter password"
        autocomplete="current-password"
        required
        autofocus
      >

      <button type="submit">Login</button>
    </form>
  </main>
</body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      },
    }
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
