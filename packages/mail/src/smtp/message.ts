/**
 * MIME 邮件构建:multipart/alternative(纯文本 + HTML),UTF-8 base64 编码。
 */
import { b64encode } from "@panel/shared";

export interface MimeInput {
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  toEmail: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
}

/** HTML 转纯文本(粗略) */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** RFC 2047 编码头(非 ASCII) */
function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const encoded = b64encode(value);
  const words: string[] = [];
  for (let i = 0; i < encoded.length; i += 40) {
    words.push(`=?UTF-8?B?${encoded.slice(i, i + 40)}?=`);
  }
  return words.join("\r\n ");
}

function addressHeader(name: string | null | undefined, email: string): string {
  if (!name) return `<${email}>`;
  const safe = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${safe}" <${email}>`;
}

/** base64 内容按 76 字符折行 */
function wrapBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join("\r\n");
}

/** 构建完整 MIME 报文(\r\n 行结尾) */
export function buildMime(input: MimeInput): string {
  const boundary = "=_Part_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const domain = input.fromEmail.split("@")[1] ?? "localhost";
  const textPart = input.text?.trim() ? input.text : htmlToText(input.html);

  const lines: string[] = [
    `Date: ${new Date().toUTCString()}`,
    `From: ${addressHeader(input.fromName, input.fromEmail)}`,
    `To: ${addressHeader(input.toName, input.toEmail)}`,
  ];
  if (input.replyTo && input.replyTo.trim()) {
    lines.push(`Reply-To: ${addressHeader(null, input.replyTo.trim())}`);
  }
  lines.push(
    `Subject: ${encodeHeaderValue(input.subject)}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(b64encode(textPart)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(b64encode(input.html)),
    `--${boundary}--`,
  );
  return lines.join("\r\n");
}
