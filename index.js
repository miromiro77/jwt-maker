// index.js
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

// ===== 공통 유틸 =====
function nowJSTString() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}. ${m}. ${day}`;
}

async function fetchJSON(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error_description || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return json;
}

// ===== 1) Vonage JWT 만들기 =====
const APPLICATION_ID = process.env.APPLICATION_ID;
const PRIVATE_KEY     = process.env.PRIVATE_KEY;

if (!APPLICATION_ID || !PRIVATE_KEY) {
  console.error("❌ APPLICATION_ID 또는 PRIVATE_KEY 환경변수가 없습니다.");
  process.exit(1);
}

function buildVonageJwt() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    application_id: APPLICATION_ID,
    iat: now,
    exp: now + 60 * 60 * 24, // 24시간
    jti: uuidv4(),
    sub: "",
    acl: "",
  };
  return jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256" });
}

// ===== 2) Google Sheet에 기록 (REST API) =====
async function writeToSheet(token) {
  const SPREADSHEET_ID       = process.env.SPREADSHEET_ID;
  const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON;

  if (!SPREADSHEET_ID || !SERVICE_ACCOUNT_JSON) {
    console.log("⚠️ [SHEET] 시트 관련 시크릿이 없어 기록을 건너뜁니다.");
    return;
  }

  const creds = JSON.parse(SERVICE_ACCOUNT_JSON);
  creds.private_key = (creds.private_key || "").replace(/\\n/g, "\n");

  // 1) 서비스계정으로 액세스 토큰 발급 (JWT Bearer)
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const assertion = jwt.sign(
    {
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      exp,
      iat,
    },
    creds.private_key,
    { algorithm: "RS256" }
  );

  const tokenResp = await fetchJSON("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  const accessToken = tokenResp.access_token;
  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };

  // 2) 'token' 시트 존재 확인, 없으면 생성
  const meta = await fetchJSON(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      SPREADSHEET_ID
    )}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const hasTokenSheet =
    Array.isArray(meta.sheets) &&
    meta.sheets.some((s) => s?.properties?.title === "token");

  if (!hasTokenSheet) {
    // 시트 추가
    await fetchJSON(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        SPREADSHEET_ID
      )}:batchUpdate`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: "token" } } }],
        }),
      }
    );
    // 헤더 A1:B1 기록
    await fetchJSON(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        SPREADSHEET_ID
      )}/values/${encodeURIComponent("token!A1:B1")}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          range: "token!A1:B1",
          majorDimension: "ROWS",
          values: [["発行日", "token"]],
        }),
      }
    );
    console.log("[SHEET] 'token' 시트를 생성했습니다.");
  }

  // 3) 값 쓰기 (A2:B2)
  await fetchJSON(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      SPREADSHEET_ID
    )}/values/${encodeURIComponent("token!A2:B2")}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        range: "token!A2:B2",
        majorDimension: "ROWS",
        values: [[nowJSTString(), token]],
      }),
    }
  );

  console.log("✅ [SHEET] token!A2:B2 업데이트 완료 (REST)");
}

// ===== 3) 실행 =====
(async () => {
  try {
    const token = buildVonageJwt();
    fs.writeFileSync("jwt.txt", token);
    console.log("✅ JWT 생성 완료! → jwt.txt 저장");

    await writeToSheet(token);
  } catch (e) {
    console.error("❌ [SHEET] 기록 실패:", e?.message || e);
    process.exitCode = 1;
  }
})();
