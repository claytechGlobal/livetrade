'use strict';
const cron = require('node-cron');
const { listActiveClients, buildDailyReport, etToday, isDailySent, markDailySent } = require('./db');
const { sendDailyReport } = require('./email');

function etNowParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.DAILY_SEND_TZ || 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const pick = t => {
    const p = parts.find(x => x.type === t);
    return p ? p.value : '';
  };
  let hour = parseInt(pick('hour'), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(pick('minute'), 10) || 0;
  return { hour: Number.isFinite(hour) ? hour : 0, minute };
}

function targetHour() {
  return Number(process.env.DAILY_SEND_HOUR || 17);
}

function isPastOrInSendWindow() {
  const target = targetHour();
  const { hour } = etNowParts();
  return hour >= target;
}

function isDailySendWindow() {
  const target = targetHour();
  const { hour } = etNowParts();
  return hour === target;
}

async function runDailySend({ force = false, fromSchedule = false } = {}) {
  if (!force && !fromSchedule && !isDailySendWindow()) {
    const { hour, minute } = etNowParts();
    return { date: etToday(), sent: 0, skipped: true, reason: 'not daily send hour', etHour: hour, etMinute: minute };
  }
  if (!force && fromSchedule && !isPastOrInSendWindow()) {
    const { hour, minute } = etNowParts();
    return { date: etToday(), sent: 0, skipped: true, reason: 'before daily send hour', etHour: hour, etMinute: minute };
  }
  const date = etToday();
  const onlyWithData = process.env.DAILY_SEND_ONLY_WITH_DATA !== 'false';
  const clients = listActiveClients();
  let sent = 0;
  let skippedNoData = 0;
  let skippedAlready = 0;
  let failed = 0;
  for (const c of clients) {
    if (!force && isDailySent(c.id, date)) {
      skippedAlready++;
      continue;
    }
    const report = buildDailyReport(c.id, date);
    if (!report) continue;
    if (onlyWithData && !report.hasToday) {
      skippedNoData++;
      continue;
    }
    try {
      await sendDailyReport(report);
      markDailySent(c.id, date);
      sent++;
    } catch (e) {
      failed++;
      console.error(`[scheduler] failed to send to ${c.id}:`, e.message);
    }
  }
  console.log(`[scheduler] daily send for ${date}: ${sent} sent, ${skippedAlready} already, ${skippedNoData} no data, ${failed} failed (${clients.length} email-enabled active).`);
  return { date, sent, skippedAlready, skippedNoData, failed, eligible: clients.length };
}

function startScheduler() {
  if (process.env.DAILY_SEND_ENABLED === 'false') {
    console.log('[scheduler] daily send disabled (DAILY_SEND_ENABLED=false).');
    return;
  }
  const hour = targetHour();
  const tz = process.env.DAILY_SEND_TZ || 'America/New_York';
  const expr = `0,5,10,15 ${hour} * * *`;
  if (!cron.validate(expr)) {
    console.error(`[scheduler] invalid schedule "${expr}" — daily send not started.`);
    return;
  }
  cron.schedule(expr, () => {
    runDailySend({ fromSchedule: true }).catch(e => console.error('[scheduler]', e.message));
  }, { timezone: tz });
  console.log(`[scheduler] daily client reports scheduled for ${String(hour).padStart(2, '0')}:00–15 ${tz} (retries + idempotent).`);

  setTimeout(() => {
    if (!isPastOrInSendWindow()) return;
    console.log('[scheduler] boot catch-up check…');
    runDailySend({ fromSchedule: true }).catch(e => console.error('[scheduler] catch-up', e.message));
  }, 20000);
}

module.exports = { startScheduler, runDailySend };
