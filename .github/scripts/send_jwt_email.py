import os
import yagmail

MAIL_USERNAME = os.environ['MAIL_USERNAME']
MAIL_PASSWORD = os.environ['MAIL_PASSWORD']
MAIL_TO = os.environ['MAIL_TO']

yag = yagmail.SMTP(user=MAIL_USERNAME, password=MAIL_PASSWORD)

yag.send(
    to=MAIL_TO,
    subject="🔐 새 JWT 토큰",
    contents="첨부된 jwt.txt 파일을 확인하세요.",
    attachments="jwt.txt"
)

print("✅ 이메일 전송 완료")
