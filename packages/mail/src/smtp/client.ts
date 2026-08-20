/**
 * SMTP 客户端 —— 基于 Cloudflare Workers TCP Sockets。
 *
 * 支持:
 *  - 465 端口隐式 SSL/TLS(secureTransport: "on")
 *  - 587 端口 STARTTLS(secureTransport: "starttls" + startTls() 升级)
 *  - 无加密直连(仅用于本地测试 / 内网中继)
 *  - AUTH LOGIN / AUTH PLAIN
 *  - 单连接多封邮件顺序发送(MAIL FROM / RCPT TO / DATA 事务)
 */
import { connect } from "cloudflare:sockets";
import { b64encode } from "@panel/shared";
import type { SmtpSecurity } from "@panel/shared";

const CRLF = "\r\n";

export type SmtpStage =
  | "connect"
  | "greeting"
  | "ehlo"
  | "starttls"
  | "auth"
  | "mail_from"
  | "rcpt_to"
  | "data"
  | "quit"
  | "timeout"
  | "closed";

export class SmtpError extends Error {
  stage: SmtpStage;
  code?: number;

  constructor(message: string, stage: SmtpStage, code?: number) {
    super(message);
    this.name = "SmtpError";
    this.stage = stage;
    this.code = code;
  }
}

export interface SmtpConnectOptions {
  host: string;
  port: number;
  security: SmtpSecurity;
  username?: string;
  password?: string;
  /** 单步操作超时(毫秒),默认 15000 */
  timeoutMs?: number;
  /** EHLO 标识域名 */
  ehloDomain?: string;
}

export interface SmtpReply {
  code: number;
  lines: string[];
  text: string;
}

/** SMTP 测试连接结果 */
export interface SmtpTestResult {
  ok: boolean;
  error: string | null;
  stage: SmtpStage | null;
  transcript: string[];
  extensions: string[];
  auth_mechanisms: string[];
}

export class SmtpClient {
  private socket: Socket | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer = "";
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private opts: Required<SmtpConnectOptions>;

  readonly extensions: string[] = [];
  readonly authMechanisms: string[] = [];
  readonly transcript: string[] = [];

  private constructor(opts: SmtpConnectOptions) {
    this.opts = {
      timeoutMs: 15000,
      ehloDomain: "smtp-panel.local",
      username: "",
      password: "",
      ...opts,
    };
  }

  /** 建立连接:TCP → (可选 TLS/STARTTLS) → EHLO → AUTH */
  static async connect(opts: SmtpConnectOptions): Promise<SmtpClient> {
    const client = new SmtpClient(opts);
    const secureTransport =
      opts.security === "ssl" ? "on" : opts.security === "starttls" ? "starttls" : "off";
    try {
      const socket = connect(
        { hostname: opts.host, port: opts.port },
        { secureTransport, allowHalfOpen: false },
      );
      await client.withTimeout(socket.opened, "connect");
      client.socket = socket;
      client.reader = socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      client.writer = socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;

      const greeting = await client.readReply();
      if (greeting.code !== 220) {
        throw new SmtpError(`服务器问候异常: ${greeting.text}`, "greeting", greeting.code);
      }

      await client.ehlo();

      if (opts.security === "starttls") {
        if (!client.extensions.some((e) => e.toUpperCase() === "STARTTLS")) {
          throw new SmtpError("服务器不支持 STARTTLS", "starttls");
        }
        const r = await client.command("STARTTLS");
        if (r.code !== 220) {
          throw new SmtpError(`STARTTLS 被拒绝: ${r.text}`, "starttls", r.code);
        }
        // 升级为 TLS,重建读写流
        client.socket = socket.startTls();
        client.reader = client.socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
        client.writer = client.socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
        client.buffer = "";
        await client.ehlo();
      }

      await client.auth();
      return client;
    } catch (err) {
      client.close();
      if (err instanceof SmtpError) throw err;
      throw new SmtpError(
        `连接失败: ${err instanceof Error ? err.message : String(err)}`,
        "connect",
      );
    }
  }

  /** 发送单封邮件(MIME 内容),复用当前连接 */
  async sendMail(from: string, to: string, mime: string): Promise<SmtpReply> {
    let r = await this.command(`MAIL FROM:<${from}>`);
    if (r.code !== 250) {
      throw new SmtpError(`MAIL FROM 被拒绝: ${r.text}`, "mail_from", r.code);
    }
    r = await this.command(`RCPT TO:<${to}>`);
    if (r.code !== 250 && r.code !== 251) {
      throw new SmtpError(`收件人被拒绝: ${r.text}`, "rcpt_to", r.code);
    }
    r = await this.command("DATA");
    if (r.code !== 354) {
      throw new SmtpError(`DATA 被拒绝: ${r.text}`, "data", r.code);
    }
    let payload = mime.endsWith(CRLF) ? mime : mime + CRLF;
    // 点填充:以 . 开头的行前补一个 .
    payload = payload.replace(/(^|\r\n)\./g, "$1..");
    await this.write(payload);
    await this.write(CRLF + "." + CRLF);
    r = await this.readReply();
    if (r.code !== 250) {
      throw new SmtpError(`邮件被服务器拒绝: ${r.text}`, "data", r.code);
    }
    return r;
  }

  async quit(): Promise<void> {
    try {
      await this.command("QUIT");
    } catch {
      // 忽略退出错误
    } finally {
      this.close();
    }
  }

  close(): void {
    try {
      this.reader?.cancel().catch(() => {});
    } catch {
      /* noop */
    }
    try {
      this.writer?.close().catch(() => {});
    } catch {
      /* noop */
    }
    try {
      this.socket?.close();
    } catch {
      /* noop */
    }
    this.reader = null;
    this.writer = null;
    this.socket = null;
  }

  // ===== 内部实现 =====

  private async ehlo(): Promise<void> {
    const r = await this.command(`EHLO ${this.opts.ehloDomain}`);
    if (r.code !== 250) {
      throw new SmtpError(`EHLO 被拒绝: ${r.text}`, "ehlo", r.code);
    }
    this.extensions.length = 0;
    this.authMechanisms.length = 0;
    for (const line of r.lines.slice(1)) {
      const rest = line.slice(4).trim();
      if (!rest) continue;
      const cap = rest.split(" ")[0]?.toUpperCase();
      if (!cap) continue;
      this.extensions.push(cap);
      if (cap === "AUTH") {
        this.authMechanisms.push(
          ...rest
            .slice(5)
            .trim()
            .toUpperCase()
            .split(/[\s,]+/)
            .filter(Boolean),
        );
      }
    }
  }

  private async auth(): Promise<void> {
    const { username, password } = this.opts;
    if (!username) return; // 无需认证
    const advertised = this.authMechanisms.length > 0;
    const supports = (m: string) => !advertised || this.authMechanisms.includes(m);

    if (supports("LOGIN")) {
      let r = await this.command("AUTH LOGIN");
      if (r.code !== 334) throw new SmtpError(`AUTH LOGIN 被拒绝: ${r.text}`, "auth", r.code);
      r = await this.command(b64encode(username));
      if (r.code !== 334) throw new SmtpError(`用户名被拒绝: ${r.text}`, "auth", r.code);
      r = await this.command(b64encode(password));
      if (r.code !== 235) throw new SmtpError(`认证失败(密码或账号错误): ${r.text}`, "auth", r.code);
    } else if (supports("PLAIN")) {
      const r = await this.command("AUTH PLAIN " + b64encode(`\u0000${username}\u0000${password}`));
      if (r.code !== 235) throw new SmtpError(`认证失败: ${r.text}`, "auth", r.code);
    } else {
      // 服务器未声明认证方式,尝试 LOGIN
      let r = await this.command("AUTH LOGIN");
      if (r.code !== 334) throw new SmtpError(`服务器不支持认证: ${r.text}`, "auth", r.code);
      r = await this.command(b64encode(username));
      if (r.code !== 334) throw new SmtpError(`用户名被拒绝: ${r.text}`, "auth", r.code);
      r = await this.command(b64encode(password));
      if (r.code !== 235) throw new SmtpError(`认证失败: ${r.text}`, "auth", r.code);
    }
  }

  private async command(cmd: string): Promise<SmtpReply> {
    if (!this.writer || !this.reader) throw new SmtpError("连接已关闭", "closed");
    await this.write(cmd + CRLF);
    const reply = await this.readReply();
    this.transcript.push(`> ${maskSecret(cmd)}`);
    this.transcript.push(`< ${reply.text}`);
    return reply;
  }

  private async write(data: string): Promise<void> {
    if (!this.writer) throw new SmtpError("连接已关闭", "closed");
    await this.writer.write(this.encoder.encode(data));
  }

  private async readReply(): Promise<SmtpReply> {
    for (;;) {
      const parsed = this.tryParseReply();
      if (parsed) {
        this.buffer = this.buffer.slice(parsed.consumed);
        return parsed;
      }
      if (!this.reader) throw new SmtpError("连接已关闭", "closed");
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await this.withTimeout(this.reader.read(), "timeout");
      } catch (err) {
        this.close();
        throw err;
      }
      if (chunk.done) {
        this.close();
        throw new SmtpError("连接被服务器关闭", "closed");
      }
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  /** 解析多行 SMTP 应答,返回 null 表示数据不完整 */
  private tryParseReply(): (SmtpReply & { consumed: number }) | null {
    const lines: string[] = [];
    let pos = 0;
    while (pos < this.buffer.length) {
      const nl = this.buffer.indexOf("\n", pos);
      if (nl === -1) return null;
      let line = this.buffer.slice(pos, nl);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const m = /^(\d{3})([- ])(.*)$/.exec(line);
      if (!m) {
        lines.push(line);
        pos = nl + 1;
        continue;
      }
      lines.push(`${m[1]} ${m[3]}`);
      if (m[2] === "-") {
        pos = nl + 1;
        continue;
      }
      return {
        code: parseInt(m[1], 10),
        lines,
        text: lines.join(" / "),
        consumed: nl + 1,
      };
    }
    return null;
  }

  private withTimeout<T>(p: Promise<T>, stage: SmtpStage): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new SmtpError(`操作超时(${this.opts.timeoutMs}ms)`, stage)),
        this.opts.timeoutMs,
      );
    });
    return Promise.race([p, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}

/** AUTH 命令中的 base64 凭据脱敏 */
function maskSecret(cmd: string): string {
  if (/^AUTH PLAIN /i.test(cmd)) return "AUTH PLAIN ***";
  if (/^[A-Za-z0-9+/=]{8,}$/.test(cmd) && cmd.length > 16) return "***";
  return cmd;
}

/**
 * 测试 SMTP 连接:连接 → TLS → EHLO → AUTH → QUIT,返回逐阶段记录。
 */
export async function testSmtpConnection(opts: SmtpConnectOptions): Promise<SmtpTestResult> {
  const result: SmtpTestResult = {
    ok: false,
    error: null,
    stage: null,
    transcript: [],
    extensions: [],
    auth_mechanisms: [],
  };
  let client: SmtpClient | null = null;
  try {
    client = await SmtpClient.connect(opts);
    result.ok = true;
    result.transcript = [...client.transcript];
    result.extensions = [...client.extensions];
    result.auth_mechanisms = [...client.authMechanisms];
    await client.quit();
    result.transcript.push("< 连接正常关闭");
  } catch (err) {
    const e = err as SmtpError;
    result.error = e instanceof SmtpError ? e.message : String(err);
    result.stage = e instanceof SmtpError ? e.stage : "connect";
    if (client) result.transcript = [...client.transcript];
    client?.close();
  }
  return result;
}
