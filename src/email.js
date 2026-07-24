'use strict';
const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const { getSettings } = require('./db');

let resend = null;
let transport = null;

if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
} else if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

function mailFrom() {
  return process.env.MAIL_FROM || 'LIVE TRADES <noreply@planthetrade.co>';
}

function emailEnabled() {
  return !!(resend || transport);
}

async function sendMail({ to, subject, text, html }) {
  if (!to) return;
  if (resend) {
    const { error } = await resend.emails.send({ from: mailFrom(), to, subject, text, html });
    if (error) throw new Error(error.message || JSON.stringify(error));
    return;
  }
  if (transport) {
    await transport.sendMail({ from: mailFrom(), to, subject, text, html });
    return;
  }
  console.log(`[email disabled] ${to}: ${subject}`);
}

function money(n) {
  const v = Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + v;
}
function moneyPlain(n) {
  const v = Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-' : '+') + '$' + v;
}
function pnlColor(n) {
  if (n > 0) return '#059669';
  if (n < 0) return '#dc2626';
  return '#6b7280';
}
function pnlBg(n) {
  if (n > 0) return '#ecfdf5';
  if (n < 0) return '#fef2f2';
  return '#f9fafb';
}
function pkgLabel(k) {
  const m = { starter: 'Starter', pro: 'Pro', elite: 'Elite', prime: 'Prime' };
  return m[k] || String(k || 'Starter');
}

function weekCalendarText(week) {
  if (!week || !week.days) return '';
  return '\nThis week (Mon–Fri ET):\n' + week.days.map(d => {
    if (d.isFuture) return `  ${d.label}: —`;
    if (!d.hasData) return `  ${d.label}: no data`;
    return `  ${d.label}: ${money(d.amount)}`;
  }).join('\n') + `\n  Week total: ${money(week.weekTotal)} · ${week.greenDays} green / ${week.redDays} red`;
}

function weekCalendarHtml(week, todayPnl) {
  if (!week || !week.days) return '';
  const maxAbs = Math.max(1, ...week.days.filter(d => d.hasData).map(d => Math.abs(d.amount)));
  const cells = week.days.map(d => {
    let inner;
    if (d.isFuture) {
      inner = `<div style="font-size:11px;color:#9ca3af;margin-top:6px">—</div>`;
    } else if (!d.hasData) {
      inner = `<div style="font-size:11px;color:#9ca3af;margin-top:6px">$0.00</div>`;
    } else {
      const h = Math.max(8, Math.round(Math.abs(d.amount) / maxAbs * 48));
      const barColor = d.amount > 0 ? '#34d399' : d.amount < 0 ? '#fb7185' : '#d1d5db';
      inner = `<div style="height:52px;display:flex;align-items:flex-end;justify-content:center;margin:8px 0 4px">
        <div style="width:18px;height:${h}px;background:${barColor};border-radius:4px 4px 0 0"></div>
      </div>
      <div style="font-size:12px;font-weight:700;color:${pnlColor(d.amount)}">${money(d.amount)}</div>`;
    }
    const todayRing = d.isToday ? 'border:2px solid #22b8ef;' : 'border:1px solid #e5e7eb;';
    const bg = d.hasData && !d.isFuture ? pnlBg(d.amount) : '#fff';
    return `<td style="width:20%;padding:4px;vertical-align:top">
      <div style="background:${bg};${todayRing}border-radius:10px;padding:10px 6px;text-align:center;min-height:108px">
        <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:.04em">${d.weekday}</div>
        ${inner}
      </div>
    </td>`;
  }).join('');
  return `<div style="margin:22px 0 8px">
    <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:10px">This week · Mon–Fri (ET)</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${cells}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-collapse:separate;border-spacing:8px 0">
      <tr>
        <td style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;width:25%">
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Week P&amp;L</div>
          <div style="font-size:16px;font-weight:700;color:${pnlColor(week.weekTotal)};margin-top:4px">${money(week.weekTotal)}</div>
        </td>
        <td style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;width:25%">
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Green days</div>
          <div style="font-size:16px;font-weight:700;color:#059669;margin-top:4px">${week.greenDays}<span style="font-size:12px;color:#9ca3af;font-weight:500"> / ${week.tradingDays}</span></div>
        </td>
        <td style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;width:25%">
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Win rate</div>
          <div style="font-size:16px;font-weight:700;color:#111827;margin-top:4px">${week.winRate}%</div>
        </td>
        <td style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;width:25%">
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Today</div>
          <div style="font-size:16px;font-weight:700;color:${pnlColor(todayPnl)};margin-top:4px">${money(todayPnl)}</div>
        </td>
      </tr>
    </table>
  </div>`;
}

function streakLine(streak) {
  if (!streak || !streak.count) return { text: '', html: '' };
  const label = streak.type === 'win' ? 'winning' : streak.type === 'loss' ? 'losing' : '';
  if (!label) return { text: '', html: '' };
  const text = `\nStreak: ${streak.count} ${label} day${streak.count > 1 ? 's' : ''} in a row`;
  const color = streak.type === 'win' ? '#059669' : '#dc2626';
  const html = `<p style="margin:14px 0 0;font-size:13px;color:${color};font-weight:600">${streak.count} ${label} day${streak.count > 1 ? 's' : ''} in a row</p>`;
  return { text, html };
}

function liveSessionBlock(html) {
  const s = getSettings();
  const url = (s.liveSessionUrl || '').trim();
  const on = s.liveSessionEnabled !== false;
  if (!on) return { text: '', html: '' };
  const lines = [
    'Live coaching schedule (ET):',
    '  Morning — Mon–Fri 9:00 AM – 10:30 AM',
    '  Evening — Mon & Wed 9:00 PM'
  ];
  if (url && /^https?:\/\//i.test(url)) lines.push('  Join: ' + url);
  const text = '\n\n' + lines.join('\n');
  const link = url && /^https?:\/\//i.test(url)
    ? `<p style="margin-top:12px"><a href="${url}" style="color:#22b8ef">Join live session</a></p>`
    : '';
  const htmlBlock = `<div style="margin-top:20px;padding:14px;background:#f4f6f8;border-radius:8px;font-size:14px">
    <b>Live coaching (ET)</b>
    <p style="margin:8px 0 0;color:#555">Mon–Fri · 9:00 AM – 10:30 AM<br>Mon &amp; Wed · 9:00 PM</p>
    ${link}
  </div>`;
  return { text, html: htmlBlock };
}

async function sendAccessCode(client, opts) {
  if (!client || !client.access_code) return;
  const force = !!(opts && opts.force);
  const { isProcessed, markProcessed } = require('./db');
  const dedupeKey = 'accessmail:' + (client.id || '') + ':' + (client.access_code || '');
  if (!force && client.id && isProcessed(dedupeKey)) {
    console.log('[email] skip duplicate access-code mail for', client.id);
    return { skipped: true };
  }
  if (!client.email) {
    console.log('[email] skip access code — no email for', client.id || client.name);
    return;
  }
  const url = process.env.APP_URL || 'https://planthetrade.co';
  const live = liveSessionBlock(false);
  const monthly = client.package === 'access' || !!client.access_expires_at;
  let expLine = '';
  if (monthly && client.access_expires_at) {
    const d = new Date(client.access_expires_at).toLocaleDateString('en-US', {
      timeZone: process.env.DAILY_SEND_TZ || 'America/New_York',
      month: 'short', day: 'numeric', year: 'numeric'
    });
    expLine = `\nValid until: ${d} (renews automatically while subscribed)`;
  }
  const text =
`Your client portal is ready.

Access code: ${client.access_code}
Log in: ${url}${expLine}

Enter this code on the login / Get Started screen to open your dashboard.
Keep this code private — it is your key to the portal.${live.text}`;

  const expHtml = monthly && client.access_expires_at
    ? `<p style="color:#059669;font-size:13px;margin-top:10px">Valid until <b>${new Date(client.access_expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</b>. Renews with your $45/mo subscription.</p>`
    : '';

  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#15181d">
  <h2 style="font-weight:600">Your portal is ready</h2>
  <p>Hi ${client.name || 'there'},</p>
  <p>Your access code:</p>
  <p style="font-size:22px;font-weight:700;letter-spacing:.08em">${client.access_code}</p>
  ${expHtml}
  <p><a href="${url}" style="background:#22b8ef;color:#04121a;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open client portal</a></p>
  <p style="color:#666;font-size:13px">Keep this code private. Enter it under Get Started on the site.</p>
  ${live.html}
</div>`;

  await sendMail({
    to: client.email,
    subject: monthly ? 'Your LIVE TRADES access code ($45/mo)' : 'Your LIVE TRADES portal access code',
    text,
    html
  });
  if (client.id) markProcessed(dedupeKey);
  return { ok: true };
}

async function sendDailyReport(r) {
  if (!r || !r.email) {
    console.log(`[daily report] skipped — no email for ${r && r.name}`);
    return;
  }
  const live = liveSessionBlock(false);
  const streak = streakLine(r.streak);
  const week = r.week || { days: [], weekTotal: 0, greenDays: 0, redDays: 0, tradingDays: 0, winRate: 0 };
  const month = r.month || { tradingDays: 0, greenDays: 0, winRate: 0, net: r.mtd };
  const dateLabel = r.dateLabel || r.date;
  const subject = `${dateLabel.split(',')[0]} — ${moneyPlain(r.todayPnl)} · Week ${moneyPlain(week.weekTotal)}`;
  const text =
`Hi ${r.name || 'there'},

${dateLabel} (ET)
Today's P&L: ${money(r.todayPnl)}
${weekCalendarText(week)}
Month-to-date: ${money(r.mtd)} (${month.greenDays} green days · ${month.winRate}% win rate)
Total to date: ${money(r.total)}
Net to you (after ${r.split}% fee): ${money(r.net)}${streak.text}

View your dashboard: ${r.appUrl || process.env.APP_URL || ''}${live.text}

Sent automatically at 5:00 PM ET.`;

  const html =
`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">
  <tr><td style="background:#0b1220;padding:22px 24px">
    <div style="font-size:11px;font-weight:700;color:#22b8ef;letter-spacing:.12em;text-transform:uppercase">LIVE TRADES</div>
    <div style="font-size:18px;font-weight:700;color:#ffffff;margin-top:6px">Daily Performance Report</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:4px">${dateLabel}</div>
  </td></tr>
  <tr><td style="padding:24px">
    <p style="margin:0 0 16px;color:#4b5563;font-size:15px">Hi ${r.name || 'there'},</p>
    <div style="background:${pnlBg(r.todayPnl)};border:1px solid ${r.todayPnl >= 0 ? '#a7f3d0' : '#fecaca'};border-radius:12px;padding:18px 20px;text-align:center">
      <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em">Today's P&amp;L</div>
      <div style="font-size:36px;font-weight:800;color:${pnlColor(r.todayPnl)};margin-top:6px;line-height:1.1">${money(r.todayPnl)}</div>
      <div style="font-size:12px;color:#9ca3af;margin-top:8px">${pkgLabel(r.package)} plan · ${r.accountCount || 0} account${(r.accountCount || 0) !== 1 ? 's' : ''} · ${r.split}% split</div>
    </div>
    ${weekCalendarHtml(week, r.todayPnl)}
    ${streak.html}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid #e5e7eb">
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #f3f4f6"><span style="color:#6b7280;font-size:14px">Month-to-date</span></td>
        <td style="padding:14px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-size:15px;font-weight:600;color:${pnlColor(r.mtd)}">${money(r.mtd)}</td>
      </tr>
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #f3f4f6"><span style="color:#6b7280;font-size:14px">Month win rate</span></td>
        <td style="padding:14px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-size:15px;font-weight:600;color:#111827">${month.winRate}% <span style="color:#9ca3af;font-weight:400">(${month.greenDays}/${month.tradingDays} days)</span></td>
      </tr>
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #f3f4f6"><span style="color:#6b7280;font-size:14px">Total to date</span></td>
        <td style="padding:14px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-size:15px;font-weight:600;color:${pnlColor(r.total)}">${money(r.total)}</td>
      </tr>
      <tr>
        <td style="padding:14px 0"><span style="color:#6b7280;font-size:14px">Net to you <span style="font-size:12px">(after ${r.split}% fee)</span></span></td>
        <td style="padding:14px 0;text-align:right;font-size:16px;font-weight:700;color:${pnlColor(r.net)}">${money(r.net)}</td>
      </tr>
    </table>
    ${r.appUrl ? `<div style="text-align:center;margin-top:22px">
      <a href="${r.appUrl}" style="display:inline-block;background:#22b8ef;color:#04121a;text-decoration:none;padding:12px 28px;border-radius:9px;font-weight:700;font-size:14px">View full dashboard</a>
    </div>` : ''}
    ${live.html}
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:20px 0 0;line-height:1.5">Sent at 5:00 PM ET · planthetrade.co<br>Performance figures reflect reported daily P&amp;L in your portal.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  await sendMail({ to: r.email, subject, text, html });
}

function contractNotifyTo() {
  return process.env.CONTRACT_NOTIFY_EMAIL || process.env.ADMIN_NOTIFY_EMAIL || '';
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendContractSubmission({
  to,
  clientName,
  clientEmail,
  clientId,
  packageKey,
  signedAt,
  entries,
  answers
}) {
  const notify = to || contractNotifyTo();
  if (!notify) {
    console.warn('[contract] CONTRACT_NOTIFY_EMAIL not set — skipping owner copy');
    return { sent: false, reason: 'CONTRACT_NOTIFY_EMAIL not set' };
  }

  const rows = Array.isArray(answers) && answers.length
    ? answers
    : Object.entries(entries || {}).map(([k, v]) => ({
      label: k,
      value: Array.isArray(v) ? v.join(', ') : String(v)
    }));

  const textLines = [
    'New signed Trade Copier Participation Contract',
    '',
    `Signed at: ${signedAt || new Date().toISOString()}`,
    `Client: ${clientName || '—'}`,
    `Email: ${clientEmail || '—'}`,
    `Client ID: ${clientId || '—'}`,
    `Package: ${packageKey || '—'}`,
    '',
    'Answers:',
    ...rows.map(r => `- ${r.label}: ${r.value}`)
  ];

  const answerRows = rows.map(r => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;vertical-align:top;width:38%">${escapeHtml(r.label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;font-weight:600">${escapeHtml(r.value)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#0b1220;color:#fff;padding:20px 24px">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.7">Plant The Trade</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">Signed contract received</div>
    </td></tr>
    <tr><td style="padding:22px 24px">
      <p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.5">A client signed and submitted the Trade Copier Participation Contract.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:18px">
        <tr><td style="padding:8px 12px;background:#f9fafb;color:#6b7280;font-size:12px;width:38%">Signed at</td><td style="padding:8px 12px;font-size:13px;font-weight:600">${escapeHtml(signedAt || '')}</td></tr>
        <tr><td style="padding:8px 12px;background:#f9fafb;color:#6b7280;font-size:12px">Client</td><td style="padding:8px 12px;font-size:13px;font-weight:600">${escapeHtml(clientName || '—')}</td></tr>
        <tr><td style="padding:8px 12px;background:#f9fafb;color:#6b7280;font-size:12px">Email</td><td style="padding:8px 12px;font-size:13px;font-weight:600">${escapeHtml(clientEmail || '—')}</td></tr>
        <tr><td style="padding:8px 12px;background:#f9fafb;color:#6b7280;font-size:12px">Client ID</td><td style="padding:8px 12px;font-size:13px;font-weight:600">${escapeHtml(clientId || '—')}</td></tr>
        <tr><td style="padding:8px 12px;background:#f9fafb;color:#6b7280;font-size:12px">Package</td><td style="padding:8px 12px;font-size:13px;font-weight:600">${escapeHtml(packageKey || '—')}</td></tr>
      </table>
      <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px">Contract answers</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        ${answerRows || '<tr><td style="padding:12px;color:#6b7280">No answers captured</td></tr>'}
      </table>
    </td></tr>
  </table>
</body></html>`;

  await sendMail({
    to: notify,
    subject: `Signed contract — ${clientName || clientEmail || 'client'}`,
    text: textLines.join('\n'),
    html
  });
  return { sent: true, to: notify };
}

module.exports = {
  sendAccessCode,
  sendDailyReport,
  sendContractSubmission,
  contractNotifyTo,
  emailEnabled,
  mailFrom
};
