import net from "node:net";
import tls from "node:tls";
function b64(v) { return Buffer.from(v, "utf8").toString("base64"); }
function cleanHeader(v) { return v.replace(/[\r\n]+/g, " ").trim(); }
function dotStuff(v) { return v.replace(/\r?\n/g, "\r\n").replace(/^\./gm, ".."); }
async function smtpSession(socket, cfg, mail) {
    socket.setTimeout(20_000);
    let buffer = "";
    const pending = [];
    const consume = () => {
        for (;;) {
            const idx = buffer.indexOf("\n");
            if (idx < 0 || pending.length === 0)
                return;
            const firstLine = buffer.slice(0, idx + 1);
            const code = Number(firstLine.slice(0, 3));
            if (!Number.isFinite(code)) {
                buffer = buffer.slice(idx + 1);
                continue;
            }
            let end = idx + 1;
            let line = firstLine;
            if (line[3] === "-") {
                let search = end;
                for (;;) {
                    const next = buffer.indexOf("\n", search);
                    if (next < 0)
                        return;
                    const candidate = buffer.slice(search, next + 1);
                    end = next + 1;
                    if (candidate.startsWith(`${code} `))
                        break;
                    search = next + 1;
                }
            }
            const response = buffer.slice(0, end);
            buffer = buffer.slice(end);
            const p = pending.shift();
            if (p.codes.includes(code))
                p.resolve(response);
            else
                p.reject(new Error(`SMTP ${code}: ${response.trim()}`));
        }
    };
    socket.on("data", chunk => { buffer += chunk.toString("utf8"); consume(); });
    socket.on("error", err => { while (pending.length)
        pending.shift().reject(err); });
    socket.on("timeout", () => { const err = new Error("SMTP timeout"); while (pending.length)
        pending.shift().reject(err); socket.destroy(); });
    const expect = (codes) => new Promise((resolve, reject) => { pending.push({ resolve, reject, codes }); consume(); });
    const send = async (line, codes) => { socket.write(line + "\r\n"); return expect(codes); };
    await expect([220]);
    await send(`EHLO ${cfg.helo}`, [250]);
    if (cfg.user) {
        await send("AUTH LOGIN", [334]);
        await send(b64(cfg.user), [334]);
        await send(b64(cfg.pass), [235]);
    }
    await send(`MAIL FROM:<${cfg.fromAddress}>`, [250]);
    for (const to of mail.to)
        await send(`RCPT TO:<${to}>`, [250, 251]);
    await send("DATA", [354]);
    const headers = [
        `From: ${cleanHeader(cfg.fromName)} <${cfg.fromAddress}>`,
        `To: ${mail.to.map(cleanHeader).join(", ")}`,
        `Subject: =?UTF-8?B?${b64(cleanHeader(mail.subject))}?=`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        `Date: ${new Date().toUTCString()}`
    ].join("\r\n");
    socket.write(`${headers}\r\n\r\n${dotStuff(mail.text)}\r\n.\r\n`);
    await expect([250]);
    try {
        await send("QUIT", [221]);
    }
    catch { /* server may close first */ }
    socket.end();
}
export class Mailer {
    cfg;
    constructor(env = process.env) {
        const user = env.SMTP_USER || "";
        const from = env.SMTP_FROM || user;
        this.cfg = {
            host: env.SMTP_HOST || "",
            port: Number(env.SMTP_PORT || (String(env.SMTP_SECURE).toLowerCase() === "true" ? 465 : 25)),
            secure: String(env.SMTP_SECURE || "true").toLowerCase() !== "false",
            user,
            pass: env.SMTP_PASS || "",
            fromAddress: from,
            fromName: env.SMTP_FROM_NAME || "HomeHub",
            to: String(env.ALERT_EMAIL_TO || "").split(/[;,]/).map(x => x.trim()).filter(Boolean),
            helo: env.SMTP_HELO || "homehub.local"
        };
    }
    configured() {
        return Boolean(this.cfg.host && this.cfg.port && this.cfg.fromAddress && (!this.cfg.user || this.cfg.pass));
    }
    recipientsCount() { return this.cfg.to.length; }
    defaultRecipients() { return [...this.cfg.to]; }
    async send(subject, text, recipients) {
        if (!this.configured())
            throw new Error("email_not_configured");
        const to = (recipients?.length ? recipients : this.cfg.to).map(x => x.trim()).filter(Boolean);
        if (!to.length)
            throw new Error("email_recipient_missing");
        const socket = this.cfg.secure
            ? tls.connect({ host: this.cfg.host, port: this.cfg.port, servername: this.cfg.host, rejectUnauthorized: true })
            : net.createConnection({ host: this.cfg.host, port: this.cfg.port });
        await smtpSession(socket, this.cfg, { to, subject, text });
    }
}
