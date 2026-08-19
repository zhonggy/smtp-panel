/**
 * 本地假 SMTP 服务器,用于开发测试。
 * 接受任意登录,邮件内容打印到控制台。
 * 使用: node scripts/fake-smtp-server.mjs
 */
import { SMTPServer } from "smtp-server";

const PORT = 2525;

const server = new SMTPServer({
  // 接受任意认证
  authOptional: true,
  onAuth(auth, session, callback) {
    console.log(`[AUTH] ${auth.username} / ${auth.method}`);
    callback(null, { user: auth.username });
  },
  onMailFrom(address, session, callback) {
    callback();
  },
  onRcptTo(address, session, callback) {
    callback();
  },
  onData(stream, session, callback) {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      const from = session.envelope.mailFrom?.address ?? "?";
      const to = session.envelope.rcptTo?.map((r) => r.address).join(",") ?? "?";
      const subject = raw.match(/^Subject:\s*(.+)$/im)?.[1] ?? "(no subject)";
      console.log(`\n=== MAIL ${from} → ${to} ===`);
      console.log(`Subject: ${subject}`);
      console.log(`Size: ${raw.length} bytes`);
      console.log(`${raw.slice(0, 500)}...`);
      console.log("========================\n");
      callback();
    });
  },
  // 禁用 TLS
  secured: false,
  disabledCommands: ["STARTTLS"],
});

server.listen(PORT, () => {
  console.log(`Fake SMTP server listening on port ${PORT}`);
  console.log(`Configure SMTP in panel: host=127.0.0.1 port=${PORT} security=none`);
});