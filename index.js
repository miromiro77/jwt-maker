const fs = require("fs");
const jwt = require("jsonwebtoken");

const applicationId = "YOUR_APPLICATION_ID"; // 여기에 본인 ID 넣기
const privateKey = fs.readFileSync("./private.key");

const now = Math.floor(Date.now() / 1000);
const payload = {
  application_id: applicationId,
  iat: now,
  exp: now + 60 * 60 * 24,
  acl: {
    paths: {
      "/users/**": {},
      "/conversations/**": {},
      "/sessions/**": {},
      "/devices/**": {},
      "/image/**": {},
      "/media/**": {},
      "/messages/**": {},
      "/knocking/**": {}
    }
  }
};

const token = jwt.sign(payload, privateKey, { algorithm: "RS256" });
fs.writeFileSync("jwt.txt", token);
console.log("✅ JWT 생성 완료! → jwt.txt에 저장됨");