import { revokeSession, getTokenFromRequest } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const token = getTokenFromRequest(req);
  if (token) {
    await revokeSession(token);
  }
  const res = NextResponse.json({ success: true });
  res.cookies.set('who-we_token', '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });
  return res;
}