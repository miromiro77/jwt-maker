// index.js
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { GoogleSpreadsheet } = require("google-spreadsheet");

// ===== 1) JWT 생성 =====
const applicationId = process.env.APPLICATION_ID;
const privateKey = process.env.PRIVATE_KEY;

if (!applicationId || !privateKey) {
  console.error("❌ APPLICATION_ID 또는 PRIVATE_KEY 환경변수가 없습니다.");
  process.exit(1);
}

function jstDateString() {
  // 예: "2025. 9. 9" 형식
  const fmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  return `${y}. ${m}. ${d}`;
}

async function writeTokenToSheet(token) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const saJsonRaw = process.env.SERVICE_ACCOUNT_JSON;

  if (!spreadsheetId || !saJsonRaw) {
    console.log("ℹ️ SPREADSHEET_ID 또는 SERVICE_ACCOUNT_JSON 없음 → 시트 기록 건너뜀");
    return;
  }

  // 서비스계정 JSON 파싱 (+ private_key 줄바꿈 복원)
  let sa;
  try {
    sa = JSON.parse(saJsonRaw);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  } catch (e) {
    console.error("❌ SERVICE_ACCOUNT_JSON 파싱 오류:", e.message);
    return;
  }

  try {
    const doc = new GoogleSpreadsheet(spreadsheetId);
    await doc.useServiceAccountAuth({
      client_email: sa.client_email,
      private_key: sa.private_key,
    });
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle["token"];
    if (!sheet) {
      console.error("❌ 'token' 시트를 찾을 수 없습니다.");
      return;
    }

    // B2에 토큰, A2에 발행일(JST) 기록
    await sheet.loadCells("A2:B2");
    sheet.getCellByA1("A2").value = jstDateString();
    sheet.getCellByA1("B2").value = token;
    await sheet.saveUpdatedCells();

    console.log("✅ [SHEET] token!A2:B2 업데이트 완료");
  } catch (e) {
    console.error("❌ [SHEET] 기록 실패:", e.message);
  }
}

(async () => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      application_id: applicationId,
      iat: now,
      exp: now + 60 * 60 * 24, // 24시간
      jti: uuidv4(),
      sub: "",
      acl: "",
    };

    const token = jwt.sign(payload, privateKey, { algorithm: "RS256" });

    // 파일로도 저장 (이메일 스텝에서 사용)
    fs.writeFileSync("jwt.txt", token);
    console.log("✅ JWT 생성 완료! → jwt.txt 저장");

    // 구글시트 기록
    await writeTokenToSheet(token);
  } catch (err) {
    console.error("❌ 처리 실패:", err);
    process.exit(1);
  }
})();
