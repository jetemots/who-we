import { getUserFromRequest } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// 设置/修改用户称呼
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });

  const { name } = await req.json();
  if (typeof name !== 'string') {
    return NextResponse.json({ error: '称呼不能为空' }, { status: 400 });
  }
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) {
    return NextResponse.json({ error: '称呼不能为空' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ name: trimmed })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ name: trimmed });
}