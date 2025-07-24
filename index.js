const fs = require("fs");
const jwt = require("jsonwebtoken");

const applicationId = process.env.APPLICATION_ID;
const privateKey = process.env.PRIVATE_KEY;  // fs.readFileSync 없이 바로

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
      "/knocking/**": {},
    },
  },
};

const token = jwt.sign(payload, privateKey, { algorithm: "RS256" });

fs.writeFileSync("jwt.txt", token);
console.log("✅ JWT 생성 완료! → jwt.txt에 저장됨");
