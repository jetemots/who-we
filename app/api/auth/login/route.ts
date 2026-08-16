import { supabaseAdmin } from '@/lib/supabase';
import {
  verifyPassword,
  createSession,
  recordAuthAttempt,
  isLoginRateLimited,
  cleanupExpiredSessions,
  getClientIp,
} from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { phone, password } = await req.json();

  if (!phone || !password) {
    return NextResponse.json({ error: '手机号和密码不能为空' }, { status: 400 });
  }

  const ip = getClientIp(req);

  // 速率限制：防暴力破解
  if (await isLoginRateLimited(ip)) {
    await recordAuthAttempt(ip, phone, 'login', false);
    return NextResponse.json({ error: '尝试次数过多，请 10 分钟后再试' }, { status: 429 });
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, phone, password_hash, settings')
    .eq('phone', phone)
    .single();

  // 统一错误提示，防止通过报错区分手机号是否已注册
  if (!user || !verifyPassword(password, user.password_hash)) {
    await recordAuthAttempt(ip, phone, 'login', false);
    return NextResponse.json({ error: '手机号或密码错误' }, { status: 401 });
  }

  await recordAuthAttempt(ip, phone, 'login', true);

  // 清理过期会话，防止长期积累
  cleanupExpiredSessions();

  const token = await createSession(user.id);

  // 令牌放入 HttpOnly Cookie（防 XSS 窃取）
  // Secure 标志根据实际协议：局域网 HTTP 不启用，HTTPS 才启用
  const isHttps = req.url?.startsWith('https://');
  const res = NextResponse.json({ success: true, phone: user.phone, settings: user.settings || null });
  res.cookies.set('who-we_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttps,
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
  return res;
}