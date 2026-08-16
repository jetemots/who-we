import { supabaseAdmin } from '@/lib/supabase';
import {
  hashPassword,
  createSession,
  recordAuthAttempt,
  isRegisterRateLimited,
  getClientIp,
} from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { phone, password, name } = await req.json();

  if (!phone || !password) {
    return NextResponse.json({ error: '手机号和密码不能为空' }, { status: 400 });
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return NextResponse.json({ error: '请输入正确的11位手机号' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: '密码至少6位' }, { status: 400 });
  }

  const ip = getClientIp(req);

  // 防垃圾注册：每 IP 每小时最多 3 次
  if (await isRegisterRateLimited(ip)) {
    return NextResponse.json({ error: '注册次数过多，请 1 小时后再试' }, { status: 429 });
  }

  // 检查手机号是否已注册
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .single();
  if (existing) {
    await recordAuthAttempt(ip, phone, 'register', false);
    return NextResponse.json({ error: '该手机号已注册' }, { status: 409 });
  }

  // 名字可选，最多20字
  const trimmedName = typeof name === 'string' ? name.trim().slice(0, 20) : '';

  const passwordHash = hashPassword(password);
  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({ phone, password_hash: passwordHash, name: trimmedName || null })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAuthAttempt(ip, phone, 'register', true);

  const token = await createSession(data.id);

  // 令牌放入 HttpOnly Cookie（防 XSS 窃取）
  // Secure 标志根据实际协议：局域网 HTTP 不启用，HTTPS 才启用
  const isHttps = req.url?.startsWith('https://');
  const res = NextResponse.json({ success: true, phone, name: trimmedName || null, settings: null });
  res.cookies.set('who-we_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttps,
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
  return res;
}