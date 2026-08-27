/**
 * 매출 조회 페이지의 비밀번호 확인 도구.
 *
 * 비밀번호는 서버 환경변수(SALES_PASSWORD)에만 있고 브라우저로 나가지 않는다.
 * 로그인에 성공하면 서명된 쿠키를 주고, 이후 요청은 그 쿠키만 검사한다.
 * 쿠키에는 만료 시각과 서명만 들어가며 비밀번호는 담기지 않는다.
 */

const crypto = require('node:crypto');

const COOKIE_NAME = 'sales_session';
const MAX_AGE_SEC = 60 * 60 * 8; // 8시간

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

/** 길이가 달라도 안전하게 비교한다 (타이밍 공격 방지) */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function makeToken(secret) {
  const exp = String(Date.now() + MAX_AGE_SEC * 1000);
  return `${exp}.${sign(exp, secret)}`;
}

function verifyToken(token, secret) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;

  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d{1,15}$/.test(exp)) return false;

  const expected = sign(exp, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  return Number(exp) > Date.now();
}

function readCookie(req, name) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function sessionCookie(token) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${MAX_AGE_SEC}`
  ].join('; ');
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** 요청이 로그인된 상태인지 확인한다 */
function isAuthorized(req) {
  const secret = process.env.SALES_SECRET;
  if (!secret) return false;
  return verifyToken(readCookie(req, COOKIE_NAME), secret);
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_SEC,
  safeEqual,
  makeToken,
  verifyToken,
  readCookie,
  sessionCookie,
  clearCookie,
  isAuthorized
};
