import { supabaseAdmin } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  const { data } = await supabaseAdmin
    .from('conversations')
    .select('messages, current_module')
    .eq('session_id', sessionId)
    .eq('user_id', user.id)
    .single();

  return NextResponse.json({
    messages: data?.messages || [],
    currentModule: data?.current_module || 'module_1',
  });
}