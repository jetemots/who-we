import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "who-we",
  description: "个人深度梳理",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
