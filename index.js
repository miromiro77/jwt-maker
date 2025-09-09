// index.js
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

// ===== 0) 공통 유틸 =====
function nowJSTString() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}. ${m}. ${day}`;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error_description || res.status + " " + res.statusText;
    throw new Error(msg);
  }
  return json;
}

// ===== 1) Vonage용 JWT 생성 =====
const APPLICATION_ID = process.env.APPLICATION_ID;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!APPLICATION_ID || !PRIVATE_KEY) {
  console.error("❌ APPLICATION_ID 또는 PRIVATE_KEY 환경변수가 없습니다.");
  process.exit(1);
}

function buildVonageJwt() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    application_id: APPLICATION_ID,
    iat: now,
    exp: now + 60 * 60 * 24, // 24h
    jti: uuidv4(),
    sub: "",
    acl: "",
  };
  return jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256" });
}

// ===== 2) Google Sheet 기록 =====
async function writeToSheet(token) {
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
  const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON;
  if (!SPREADSHEET_ID || !SERVICE_ACCOUNT_JSON) {
    console.log("⚠️ [SHEET] 시트 관련 시크릿이 없어 기록을 건너뜁니다.");
    return;
  }

  const creds = JSON.parse(SERVICE_ACCOUNT_JSON);
  creds.private_key = (creds.private_key || "").replace(/\\n/g, "\n");

  // ---- 2-1) google-spreadsheet 시도 ----
  try {
    const lib = require("google-spreadsheet");
    const GoogleSpreadsheet = lib.GoogleSpreadsheet || lib; // 일부 버전에서 default export
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID);

    if (typeof doc.useServiceAccountAuth === "function") {
      await doc.useServiceAccountAuth({ client_email: creds.client_email, private_key: creds.private_key });
      console.log("[SHEET][DBG] auth=useServiceAccountAuth");
    } else if (typeof doc.useOAuth2Client === "function") {
      // 혹시 있을 경우(일부 빌드)
      const { google } = require("googleapis");
      const auth = new google.auth.JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      await doc.useOAuth2Client(auth);
      console.log("[SHEET][DBG] auth=useOAuth2Client(JWT)");
    } else {
      throw new Error("no-auth-method");
    }

    await doc.loadInfo();
    let sheet = doc.sheetsByTitle?.["token"];
    if (!sheet) {
      sheet = await doc.addSheet({ title: "token", headerValues: ["발행일", "token"] });
      console.log("[SHEET][DBG] 'token' 시트를 생성");
    }
    await sheet.loadCells("A2:B2");
    const a2 = sheet.getCell(1, 0);
    const b2 = sheet.getCell(1, 1);
    a2.value = nowJSTString();
    b2.value = token;
    await sheet.saveUpdatedCells();
    console.log("✅ [SHEET] token!A2:B2 업데이트 완료 (google-spreadsheet)");
    return; // 성공했으니 종료
  } catch (e) {
    if (e?.message !== "no-auth-method") {
      console.log("[SHEET][WARN] google-spreadsheet 경로 실패:", e?.message || e);
    } else {
      console.log("[SHEET][WARN] google-spreadsheet 인증 메서드 없음 → REST로 우회");
    }
  }

  // ---- 2-2) REST API 우회 (추가 패키지 없이 확실) ----
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

  const tokenResp = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    // x-www-form-urlencoded 형식으로 전달
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const accessToken = tokenResp.access_token;
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // 2) 시트 존재 확인, 없으면 생성
  const meta = await fetchJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}?fields=sheets.properties.title`,
    { headers: authHeader }
  );
  const hasTokenSheet = Array.isArray(meta.sheets)
    && meta.sheets.some(s => s?.properties?.title === "token");

  if (!hasTokenSheet) {
    await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}:batchUpdate`,
      {
        method: "POST",
        headers: authHeader,
        body: {
          requests: [
            { addSheet: { properties: { title: "token" } } },
            { updateCells: {
                // A1:B1 헤더(발행일, token) 한 번 써줌
                range: { sheetId: null }, // sheetId 생략하면 title로 지정 못해서 아래 values API로 대체 하자
              }
            }
          ],
        },
      }
    ).catch(() => {}); // sheet 추가만 확실히
    // 헤더는 values API로 씁니다.
    await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}/values/${encodeURIComponent("token!A1:B1")}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: authHeader,
        body: { range: "token!A1:B1", majorDimension: "ROWS", values: [["発行日", "token"]] },
      }
    );
    console.log("[SHEET][DBG] 'token' 시트를 생성(REST)");
  }

  // 3) 값 쓰기 (A2:B2)
  await fetchJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}/values/${encodeURIComponent("token!A2:B2")}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: authHeader,
      body: { range: "token!A2:B2", majorDimension: "ROWS", values: [[nowJSTString(), token]] },
    }
  );

  console.log("✅ [SHEET] token!A2:B2 업데이트 완료 (REST 우회)");
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
