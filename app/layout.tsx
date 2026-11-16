import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "who-we",
  description: "个人深度梳理",
};

// 移动端地址栏 / 状态栏跟着页面底色走，别在夜里留一条亮白边
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f2" },
    { media: "(prefers-color-scheme: dark)", color: "#16120f" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
