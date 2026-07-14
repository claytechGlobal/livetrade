'use strict';
const jwt = require('jsonwebtoken');
const { getClientRow, findActiveClientByCode } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const COOKIE = 'lt_session';
const isProd = process.env.NODE_ENV === 'production';
const secureCookie = isProd && !String(process.env.APP_URL || '').startsWith('http://');

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}
function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}
function clearCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: secureCookie, sameSite: 'lax' });
}
function authFromReq(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;
  try { return jwt.verify(token, SECRET); } catch (_) { return null; }
}
function requireAdmin(req, res, next) {
  const u = authFromReq(req);
  if (!u || u.role !== 'admin') return res.status(401).json({ error: 'Admin authentication required' });
  req.user = u; next();
}
function resolveClientUser(u, res) {
  if (!u || u.role !== 'client') return null;
  let row = u.clientId ? getClientRow(u.clientId) : null;
  if (!row && u.accessCode) row = findActiveClientByCode(u.accessCode);
  if (!row) return null;
  if (row.id !== u.clientId || row.access_code !== u.accessCode) {
    u.clientId = row.id;
    u.accessCode = row.access_code;
    if (res) setCookie(res, sign({ role: 'client', clientId: row.id, accessCode: row.access_code }));
  }
  return row;
}
function requireClient(req, res, next) {
  const u = authFromReq(req);
  if (!u || u.role !== 'client') return res.status(401).json({ error: 'Client authentication required' });
  const row = resolveClientUser(u, res);
  if (!row) {
    return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
  }
  req.user = u;
  req.clientRow = row;
  next();
}

module.exports = { sign, setCookie, clearCookie, authFromReq, requireAdmin, requireClient, resolveClientUser };
