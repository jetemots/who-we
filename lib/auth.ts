import { supabaseAdmin } from '@/lib/supabase';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// ============ 密码哈希（scrypt + 随机盐，不可逆） ============

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ============ 会话令牌（256-bit 随机，存数据库可随时吊销） ============

const SESSION_DAYS = 30;

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin
    .from('sessions')
    .insert({ user_id: userId, token, expires_at: expiresAt });
  if (error) throw new Error(error.message);
  return token;
}

export async function revokeSession(token: string): Promise<void> {
  await supabaseAdmin.from('sessions').delete().eq('token', token);
}

// ============ 速率限制（防暴力破解 / 防垃圾注册） ============

const MAX_LOGIN_FAILURES = 5; // 10 分钟内最多 5 次失败
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_REGISTER_PER_HOUR = 3; // 每 IP 每小时最多 3 次注册
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

export async function recordAuthAttempt(
  ip: string,
  phone: string | null,
  action: 'login' | 'register',
  success: boolean,
): Promise<void> {
  await supabaseAdmin.from('auth_attempts').insert({ ip, phone, action, success });
}

export async function isLoginRateLimited(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  const { count } = await supabaseAdmin
    .from('auth_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('action', 'login')
    .eq('success', false)
    .gte('created_at', since);
  return (count ?? 0) >= MAX_LOGIN_FAILURES;
}

export async function isRegisterRateLimited(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - REGISTER_WINDOW_MS).toISOString();
  const { count } = await supabaseAdmin
    .from('auth_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('action', 'register')
    .gte('created_at', since);
  return (count ?? 0) >= MAX_REGISTER_PER_HOUR;
}

// ============ 过期会话清理 ============

export async function cleanupExpiredSessions(): Promise<void> {
  await supabaseAdmin.from('sessions').delete().lt('expires_at', new Date().toISOString());
}

// ============ 请求 IP 获取 ============

export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

// ============ Cookie 令牌读取（HttpOnly Cookie 安全方案） ============

export function getTokenFromRequest(req: Request): string | null {
  // 优先 Authorization header（兼容）
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  // 从 HttpOnly Cookie 读取（生产安全方案）
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === 'who-we_token') return part.slice(idx + 1).trim();
  }
  return null;
}

// ============ 从请求验证令牌，返回当前用户 ============

export interface AuthUser {
  id: string;
  phone: string;
  name: string | null;
  settings: Record<string, unknown> | null;
}

export async function getUserFromRequest(req: Request): Promise<AuthUser | null> {
  const token = getTokenFromRequest(req);
  if (!token) return null;

  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from('sessions')
    .select('user_id, expires_at, users!inner(id, phone, name, settings)')
    .eq('token', token)
    .gt('expires_at', now)
    .single();

  if (!data) return null;
  // 多对一关联可能返回对象或数组，统一处理
  const userRel = Array.isArray(data.users) ? data.users[0] : data.users;
  if (!userRel) return null;
  return {
    id: userRel.id,
    phone: userRel.phone,
    name: userRel.name || null,
    settings: userRel.settings || null,
  };
}
