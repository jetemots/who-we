import { supabaseAdmin } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });

  const { sessionId, messages, currentModule } = await req.json();
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  // 防劫持：如果该会话已存在且归属他人，拒绝写入
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('user_id')
    .eq('session_id', sessionId)
    .single();

  if (existing && existing.user_id && existing.user_id !== user.id) {
    return NextResponse.json({ error: '无权操作该会话' }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from('conversations')
    .upsert({
      session_id: sessionId,
      user_id: user.id,
      messages,
      current_module: currentModule,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}