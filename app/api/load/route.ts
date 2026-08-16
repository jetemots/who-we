import { supabaseAdmin } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  // 优先用浏览器记录的 sessionId 查找；找不到则回退到该账号的最新会话
  // （这样换浏览器/清缓存也能恢复聊天记录）
  let data: { messages: unknown[]; current_module: string } | null = null;

  if (sessionId) {
    const r = await supabaseAdmin
      .from('conversations')
      .select('messages, current_module')
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r.data) data = r.data;
  }

  if (!data) {
    const r = await supabaseAdmin
      .from('conversations')
      .select('messages, current_module')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r.data) data = r.data;
  }

  return NextResponse.json({
    messages: data?.messages || [],
    currentModule: data?.current_module || 'module_1',
  });
}