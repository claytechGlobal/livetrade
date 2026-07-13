'use strict';
const cron = require('node-cron');
const { listActiveClients, buildDailyReport, etToday, isDailySent, markDailySent } = require('./db');
const { sendDailyReport } = require('./email');

// Sends today's report to every active client. Skips clients already sent today,
// and (by default) clients with no P&L uploaded for today.
async function runDailySend({ force = false } = {}) {
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
