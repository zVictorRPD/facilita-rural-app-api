import nodemailer from "nodemailer";

export async function sendCode(to: string, subject: string, intro: string, code: string) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) {
    console.info(`[email] ${to} — ${subject}: ${code}`);
    return;
  }
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  await transport.sendMail({
    from: `Facilita Rural <${user}>`,
    to,
    subject,
    text: `${intro}\n\n${code}\n\nO código vale por 1 hora.`,
    html: `<p>${intro}</p><p style="font-size:28px;letter-spacing:4px"><strong>${code}</strong></p><p>O código vale por 1 hora.</p>`,
  });
}
