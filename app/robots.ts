import type { MetadataRoute } from 'next'

// 로그인이 필요한 화면·API 는 크롤링에서 뺀다(구글이 방문했다가 첫 화면으로
// 리디렉션되며 서치 콘솔 경고가 났다). /subscribe 는 하위 결과 페이지까지 함께 막힌다.
// 공유 페이지(/s/)는 여기서 막지 않는다 — 막으면 구글이 페이지 안의 noindex 를 읽지 못해
// 외부 링크만으로 검색 결과에 남을 수 있다. app/s/[token]/page.tsx 의 robots 메타로 처리.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/dashboard',
        '/profile',
        '/subscribe',
        '/admin',
        '/feedback',
        '/review-login',
        '/api/',
      ],
    },
    sitemap: 'https://dailyvideodigest.com/sitemap.xml',
  }
}
