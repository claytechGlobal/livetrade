'use strict';
const cron = require('node-cron');
const { listActiveClients, buildDailyReport, etToday, isDailySent, markDailySent } = require('./db');
const { sendDailyReport } = require('./email');

function etNowParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.DAILY_SEND_TZ || 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(new Date());
  const pick = t => {
    const p = parts.find(x => x.type === t);
    return p ? p.value : '';
  };
  return { hour: Number(pick('hour')), minute: Number(pick('minute')) };
}

function isDailySendHour() {
  const target = Number(process.env.DAILY_SEND_HOUR || 17);
  const { hour, minute } = etNowParts();
  return hour === target && minute < 15;
}

async function runDailySend({ force = false } = {}) {
  if (!force && !isDailySendHour()) {
    const { hour, minute } = etNowParts();
    return { date: etToday(), sent: 0, skipped: true, reason: 'not 5 PM ET window', etHour: hour, etMinute: minute };
  }
  const date = etToday();
  const onlyWithData = process.env.DAILY_SEND_ONLY_WITH_DATA !== 'false';
  const clients = listActiveClients();
  let sent = 0;
  for (const c of clients) {
    if (!force && isDailySent(c.id, date)) continue;
    const report = buildDailyReport(c.id, date);
    if (!report) continue;
    if (onlyWithData && !report.hasToday) continue;
    try {
      await sendDailyReport(report);
      markDailySent(c.id, date);
      sent++;
    } catch (e) {
      console.error(`[scheduler] failed to send to ${c.id}:`, e.message);
    }
  }
  console.log(`[scheduler] daily send for ${date}: ${sent} report(s) sent.`);
  return { date, sent };
}

function startScheduler() {
  if (process.env.DAILY_SEND_ENABLED === 'false') {
    console.log('[scheduler] daily send disabled (DAILY_SEND_ENABLED=false).');
    return;
  }
  const hour = Number(process.env.DAILY_SEND_HOUR || 17); // 17 = 5 PM
  const tz = process.env.DAILY_SEND_TZ || 'America/New_York';
  const expr = `0 ${hour} * * *`;
  if (!cron.validate(expr)) {
    console.error(`[scheduler] invalid schedule "${expr}" — daily send not started.`);
    return;
  }
  cron.schedule(expr, () => { runDailySend().catch(e => console.error('[scheduler]', e.message)); }, { timezone: tz });
  console.log(`[scheduler] daily client reports scheduled for ${String(hour).padStart(2, '0')}:00 ${tz}.`);
}

module.exports = { startScheduler, runDailySend };
