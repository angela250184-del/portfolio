/**
 * 매출 조회 로그인/로그아웃
 *
 *   POST /api/sales-auth          { password }  → 쿠키 발급
 *   GET  /api/sales-auth          로그인 상태 확인
 *   POST /api/sales-auth?logout=1 쿠키 삭제
 */

const auth = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method === 'GET') {
    res.status(200).json({ authorized: auth.isAuthorized(req) });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: '허용되지 않은 요청 방식입니다.' });
    return;
  }

  if (req.query && req.query.logout) {
    res.setHeader('Set-Cookie', auth.clearCookie());
    res.status(200).json({ ok: true, authorized: false });
    return;
  }

  const secret = process.env.SALES_SECRET;
  const expected = process.env.SALES_PASSWORD;

  if (!secret || !expected) {
    res.status(503).json({ error: '서버에 비밀번호가 아직 설정되지 않았습니다.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const given = body && typeof body.password === 'string' ? body.password : '';

  if (!given || !auth.safeEqual(given, expected)) {
    // 무차별 대입을 조금이라도 늦춘다
    await new Promise((r) => setTimeout(r, 700));
    res.status(401).json({ error: '비밀번호가 맞지 않습니다.' });
    return;
  }

  res.setHeader('Set-Cookie', auth.sessionCookie(auth.makeToken(secret)));
  res.status(200).json({ ok: true, authorized: true });
};
