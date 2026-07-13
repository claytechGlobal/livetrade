'use strict';
const nodemailer = require('nodemailer');

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

async function sendAccessCode(client) {
  if (!client || !client.access_code) return;
  const url = process.env.APP_URL || '';
  const text =
`Your client portal is ready.

Access code: ${client.access_code}
Log in: ${url}

Enter this code on the login screen to view your daily P&L and account performance.
Keep this code private — it is your key to the portal.`;

  if (!transport) {
    console.log(`[email disabled] Access code for ${client.email || client.name}: ${client.access_code}`);
    return;
  }
  await transport.sendMail({
    from: process.env.MAIL_FROM || 'noreply@example.com',
    to: client.email,
    subject: 'Your client portal access code',
    text
  });
}

function money(n) {
  const v = Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + v;
}

// r is the object returned by db.buildDailyReport(...)
async function sendDailyReport(r) {
  if (!r || !r.email) {
    console.log(`[daily report] skipped — no email for ${r && r.name}`);
    return;
  }
  const subject = `Your trading update — ${r.date}`;
  const text =
`Hi ${r.name || 'there'},

Your managed account update for ${r.date} (ET):

  Today's P&L:                 ${money(r.todayPnl)}
  Month-to-date:               ${money(r.mtd)}
  Total to date:               ${money(r.total)}
  Net to you (after ${r.split}% fee): ${money(r.net)}

View your dashboard: ${r.appUrl || ''}
${r.accessCode ? 'Access code: ' + r.accessCode : ''}

Sent automatically at 5:00 PM ET.`;

  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#15181d">
  <h2 style="font-weight:600">Your trading update</h2>
  <p style="color:#555">${r.date} (ET)</p>
  <table style="width:100%;border-collapse:collapse;font-size:15px">
    <tr><td style="padding:8px 0;color:#555">Today's P&amp;L</td><td style="padding:8px 0;text-align:right;font-weight:600">${money(r.todayPnl)}</td></tr>
    <tr><td style="padding:8px 0;color:#555">Month-to-date</td><td style="padding:8px 0;text-align:right">${money(r.mtd)}</td></tr>
    <tr><td style="padding:8px 0;color:#555">Total to date</td><td style="padding:8px 0;text-align:right">${money(r.total)}</td></tr>
    <tr><td style="padding:8px 0;color:#555">Net to you (after ${r.split}% fee)</td><td style="padding:8px 0;text-align:right;font-weight:600">${money(r.net)}</td></tr>
  </table>
  ${r.appUrl ? `<p style="margin-top:18px"><a href="${r.appUrl}" style="background:#22b8ef;color:#04121a;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">View your dashboard</a></p>` : ''}
  <p style="color:#999;font-size:12px;margin-top:18px">Sent automatically at 5:00 PM ET.</p>
</div>`;

  if (!transport) {
    console.log(`[daily report — email disabled] ${r.email}: today ${money(r.todayPnl)} · total ${money(r.total)}`);
    return;
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || 'noreply@example.com', to: r.email, subject, text, html });
}

module.exports = { sendAccessCode, sendDailyReport };
