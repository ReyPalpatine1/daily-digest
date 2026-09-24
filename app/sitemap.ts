import type { MetadataRoute } from 'next'

// 고정 도메인이라 환경변수를 쓰지 않는다.
const BASE_URL = 'https://dailyvideodigest.com'

// 공개 페이지만 싣는다. 공유 페이지(/s/...)는 검색 제외 대상이라 넣지 않는다.
const PATHS = ['/', '/pricing', '/terms', '/privacy', '/refund', '/terms/en', '/privacy/en', '/refund/en']

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return PATHS.map(path => ({
    url: `${BASE_URL}${path}`,
    lastModified,
  }))
}
