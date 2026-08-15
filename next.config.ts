import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // 防点击劫持：禁止被 iframe 嵌入
          { key: "X-Frame-Options", value: "DENY" },
          // 防 MIME 类型混淆
          { key: "X-Content-Type-Options", value: "nosniff" },
          // 控制 Referrer 信息泄露
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 浏览器 XSS 过滤
          { key: "X-XSS-Protection", value: "1; mode=block" },
          // 限制浏览器权限（保留麦克风给语音输入）
          { key: "Permissions-Policy", value: "geolocation=(), camera=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
