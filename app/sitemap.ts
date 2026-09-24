import type { MetadataRoute } from 'next'

// 고정 도메인이라 환경변수를 쓰지 않는다.
const BASE_URL = 'https://dailyvideodigest.com'

// 단독 공개 페이지. 공유 페이지(/s/...)는 검색 제외 대상이라 넣지 않는다.
const PAGES = ['/', '/pricing']

// 약관 문서 × 언어. 문서·언어가 늘면 이 배열에만 추가한다(항목은 아래에서 조합).
// 한국어판이 정본이라 기본 주소(/{doc})이고 x-default 도 한국어판을 가리킨다.
const LEGAL_DOCS = ['terms', 'privacy', 'refund']
const LEGAL_LANGS = [
  { code: 'ko', suffix: '' },
  { code: 'en', suffix: '/en' },
  { code: 'zh', suffix: '/zh' },
  { code: 'ja', suffix: '/ja' },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  const pages = PAGES.map(path => ({ url: `${BASE_URL}${path}`, lastModified }))

  // 같은 문서의 언어판은 서로를 모두 가리켜야 한다(한쪽만 달면 구글이 무시한다) —
  // 그래서 문서마다 alternates 를 한 번 만들고 네 항목에 똑같이 단다.
  const legal = LEGAL_DOCS.flatMap(doc => {
    const languages: Record<string, string> = Object.fromEntries(
      LEGAL_LANGS.map(l => [l.code, `${BASE_URL}/${doc}${l.suffix}`])
    )
    languages['x-default'] = `${BASE_URL}/${doc}`
    return LEGAL_LANGS.map(l => ({
      url: `${BASE_URL}/${doc}${l.suffix}`,
      lastModified,
      alternates: { languages },
    }))
  })

  return [...pages, ...legal]
}
