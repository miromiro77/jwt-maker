// index.js
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

// ===== 1) JWT 만들기 =====
const APPLICATION_ID = process.env.APPLICATION_ID;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!APPLICATION_ID || !PRIVATE_KEY) {
  console.error("❌ APPLICATION_ID 또는 PRIVATE_KEY 환경변수가 없습니다.");
  process.exit(1);
}

function nowJSTString() {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
  );
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}. ${m}. ${day}`;
}

function buildJwt() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    application_id: APPLICATION_ID,
    iat: now,
    exp: now + 60 * 60 * 24,
    jti: uuidv4(),
    sub: "",
    acl: ""
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

  const doc = new GoogleSpreadsheet(SPREADSHEET_ID);

  // 메서드 유무에 따라 안전하게 인증
  if (typeof doc.useServiceAccountAuth === "function") {
    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key
    });
    console.log("[SHEET][DBG] auth=useServiceAccountAuth");
  } else if (typeof doc.useOAuth2Client === "function") {
    const client = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    await doc.useOAuth2Client(client);
    console.log("[SHEET][DBG] auth=useOAuth2Client(JWT)");
  } else {
    throw new Error("google-spreadsheet의 인증 메서드를 찾을 수 없습니다.");
  }

  await doc.loadInfo();
  console.log(`[SHEET][DBG] title="${doc.title}" sheets=${doc.sheetCount}`);

  // 'token' 시트 찾거나 생성
  let sheet = doc.sheetsByTitle?.["token"];
  if (!sheet) {
    sheet = await doc.addSheet({
      title: "token",
      headerValues: ["발행일", "token"]
    });
    console.log("[SHEET][DBG] 'token' 시트를 새로 만들었습니다.");
  }

  // A2:B2에 날짜/토큰 기록
  await sheet.loadCells("A2:B2");
  const a2 = sheet.getCell(1, 0); // row 2, col 1
  const b2 = sheet.getCell(1, 1); // row 2, col 2
  a2.value = nowJSTString();
  b2.value = token;
  await sheet.saveUpdatedCells();

  console.log("✅ [SHEET] token!A2:B2 업데이트 완료");
}

// ===== 3) 실행 =====
(async () => {
  try {
    const token = buildJwt();
    fs.writeFileSync("jwt.txt", token);
    console.log("✅ JWT 생성 완료! → jwt.txt 저장");
    await writeToSheet(token);
  } catch (e) {
    console.error("❌ [SHEET] 기록 실패:", e?.message || e);
    process.exitCode = 1;
  }
})();
