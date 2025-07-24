const fs = require("fs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

// 환경변수로부터 정보 읽기
const applicationId = process.env.APPLICATION_ID;
const privateKey = process.env.PRIVATE_KEY;

if (!applicationId || !privateKey) {
  console.error("❌ APPLICATION_ID 또는 PRIVATE_KEY 환경변수가 설정되지 않았습니다.");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const payload = {
  application_id: applicationId,
  iat: now,
  exp: now + 60 * 60 * 24, // 24시간 유효
  jti: uuidv4(),  // 고유 ID 생성
  sub: "",        // 필요시 지정, 비워둬도 됨
  acl: ""         // 빈 문자열로 설정 (jwt.io 예시와 동일하게)
};

try {
  const token = jwt.sign(payload, privateKey, { algorithm: "RS256" });
  fs.writeFileSync("jwt.txt", token);
  console.log("✅ JWT 생성 완료! → jwt.txt에 저장됨");
} catch (err) {
  console.error("❌ JWT 생성 실패:", err);
  process.exit(1);
}
