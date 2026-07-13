'use strict';
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const COOKIE = 'lt_session';
const isProd = process.env.NODE_ENV === 'production';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}
function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}
function clearCookie(res) {
  res.clearCookie(COOKIE);
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
function requireClient(req, res, next) {
  const u = authFromReq(req);
  if (!u || u.role !== 'client') return res.status(401).json({ error: 'Client authentication required' });
  req.user = u; next();
}

module.exports = { sign, setCookie, clearCookie, authFromReq, requireAdmin, requireClient };
