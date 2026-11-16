This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## 本地开发备注

### 显示设置存在哪

- 账号里：`users.settings`（换设备也跟着走）
- 本机：`localStorage['who-we_settings']`，页面一打开就先套用，不用等接口

存账号失败时（比如后端连不上数据库）不会静默丢掉：

- `localStorage['who-we_settings_unsaved'] = '1'` 留个记号
- 设置面板底部提示"这次的设置已经在这台设备上生效，只是还没存进账号"
- 下次打开页面以本机版本为准，并自动补存一次

### 浏览器能打开 Supabase，`next dev` 却连不上库

`*.supabase.co` 在部分网络下会被按 SNI 重置（TCP 能连上，TLS 握手被中断）。
Node 不会自动走 Windows 的系统代理，所以浏览器挂着代理能上，服务端照样 503。

让开发服务器也走本地代理（端口按自己客户端填）：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7890'
$env:NODE_USE_ENV_PROXY='1'   # Node 24 起，fetch 才认 HTTPS_PROXY
npm run dev
```

判断库到底通没通（带任意 cookie 才会真去查库）：

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -H "Cookie: who-we_token=x" http://localhost:3000/api/auth/me
# 401 / 200 = 库通了；503 = 还是连不上库
```

### 接口的 401 / 503 区别

- `401`：确实没登录或会话过期
- `503`：后端连不上数据库（响应里带 `detail`），页面会提示网络问题而不是"请重新登录"

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
