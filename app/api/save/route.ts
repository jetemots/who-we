import { supabaseAdmin } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });

  const { sessionId, messages, currentModule } = await req.json();

  // 保持"每账号单一会话"：优先复用该账号已有的会话 session_id
  // （这样即使浏览器缓存被清，仍能保存到原会话，聊天记录不丢）
  let targetSessionId = sessionId;
  const { data: accountConv } = await supabaseAdmin
    .from('conversations')
    .select('session_id, user_id')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accountConv) {
    targetSessionId = accountConv.session_id;
  }

  if (!targetSessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  // 防劫持：如果目标会话已存在且归属他人，拒绝写入
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('user_id')
    .eq('session_id', targetSessionId)
    .single();

  if (existing && existing.user_id && existing.user_id !== user.id) {
    return NextResponse.json({ error: '无权操作该会话' }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from('conversations')
    .upsert({
      session_id: targetSessionId,
      user_id: user.id,
      messages,
      current_module: currentModule,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}