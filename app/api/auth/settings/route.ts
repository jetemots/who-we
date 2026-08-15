import { getUserFromRequest } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

const FONT_SIZES = [14, 16, 18, 20];

// 保存显示设置（字体大小 / 字体颜色 / 背景颜色），按账号记忆
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });

  const { settings } = await req.json();
  if (!settings || typeof settings !== 'object') {
    return NextResponse.json({ error: '设置格式不正确' }, { status: 400 });
  }

  // 只接受受控字段，防止注入任意数据
  const cleaned = {
    fontSize: FONT_SIZES.includes(settings.fontSize) ? settings.fontSize : 16,
    textColor: typeof settings.textColor === 'string' ? settings.textColor : '#1f2937',
    bgColor: typeof settings.bgColor === 'string' ? settings.bgColor : '#ffffff',
  };

  const { error } = await supabaseAdmin
    .from('users')
    .update({ settings: cleaned })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: cleaned });
}