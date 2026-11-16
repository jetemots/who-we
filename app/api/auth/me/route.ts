import { lookupUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { user, dbError } = await lookupUser(req);

  // 连不上数据库 ≠ 没登录：给前端一个能分辨的信号，否则只会一直被踢回登录页
  if (dbError) {
    return NextResponse.json(
      { error: '服务器连不上数据库，请检查网络后再试', detail: dbError },
      { status: 503 },
    );
  }
  if (!user) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });
  return NextResponse.json({ phone: user.phone, name: user.name, settings: user.settings });
}