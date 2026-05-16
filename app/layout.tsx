import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// 영문/숫자 본문 폰트
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// 모노스페이스 (코드, 숫자 정렬)
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// 한글 본문 폰트 Pretendard 는 globals.css 의 CDN @import 로 로드됨

export const metadata: Metadata = {
  title: "Daily Digest",
  description: "유튜브 AI 요약 에이전트 / YouTube AI Summary Agent",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Daily Digest",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

// 모바일 브라우저 상단바 색상도 OS 다크/라이트 선호도 따라 자동 변경
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAFAFA" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0A" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// React 렌더 전에 실행되어 라이트→다크 플래시(FOUC) 방지 + 초기 언어(lang) 설정.
// 테마: localStorage 우선 → 시스템 선호도 폴백. 언어: localStorage 우선 → 브라우저 언어 폴백.
const themeBootstrapScript = `(function(){try{var s=localStorage.getItem('theme');var p=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var t=(s==='light'||s==='dark')?s:(p?'dark':'light');document.documentElement.dataset.theme=t;var l=localStorage.getItem('locale');if(l!=='ko'&&l!=='en'){l=(navigator.language||'').toLowerCase().indexOf('ko')===0?'ko':'en';}document.documentElement.lang=l;}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body
        style={{
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {children}
      </body>
    </html>
  );
}
