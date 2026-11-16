import { lookupUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

const FONT_SIZES = [14, 15, 16, 17, 18, 19, 20, 21];
const FONT_FAMILIES = ['sans', 'serif'];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// 只放行 #rrggbb，避免把奇怪的值写进样式
function pickColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;
}

// 保存显示设置（字体大小 / 字体 / 字体颜色 / 背景颜色），按账号记忆
export async function POST(req: Request) {
  const { user, dbError } = await lookupUser(req);

  // 连不上库 ≠ 没登录：前端拿到 503 才知道"是没存上"，而不是"该重新登录了"
  if (dbError) {
    return NextResponse.json(
      { error: '服务器连不上数据库，设置稍后会自动重试', detail: dbError },
      { status: 503 },
    );
  }
  if (!user) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });

  const { settings } = await req.json();
  if (!settings || typeof settings !== 'object') {
    return NextResponse.json({ error: '设置格式不正确' }, { status: 400 });
  }

  // 只接受受控字段，防止注入任意数据
  const cleaned = {
    fontSize: FONT_SIZES.includes(settings.fontSize) ? settings.fontSize : 17,
    textColor: pickColor(settings.textColor, '#50554c'),
    bgColor: pickColor(settings.bgColor, '#f7f6f0'),
    fontFamily: FONT_FAMILIES.includes(settings.fontFamily) ? settings.fontFamily : 'sans',
  };

  const { error } = await supabaseAdmin
    .from('users')
    .update({ settings: cleaned })
    .eq('id', user.id);

  // 写不进去多半还是连不上库，别让前端以为"已经存好了"
  if (error) {
    return NextResponse.json(
      { error: '设置没能存进账号，稍后会自动重试', detail: error.message },
      { status: 503 },
    );
  }
  return NextResponse.json({ settings: cleaned });
}