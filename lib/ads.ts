// 제휴 광고 링크 상수. 서버(email-templates, ad-click 라우트)와 클라이언트 모두에서 사용 가능.
// 향후 카테고리별 링크는 이 맵에 키를 추가한다 — 지금은 default(골드박스)만.
export const PARTNER_LINKS: Record<string, string> = {
  default: 'https://link.coupang.com/a/fqcYgp1Ike', // 골드박스(상시)
  banner: 'https://link.coupang.com/a/fq9z7BzDz2', // 골드박스 배너(HTML 태그형)
}

// 쿠팡 발급 배너 이미지(728x90). 발급값 그대로 — 수정 금지.
export const PARTNER_BANNER_IMG = 'https://ads-partners.coupang.com/banners/1007442?trackingCode=AF5185528&subId=&traceId=V0-301-969b06e95b87326d-I1007442&w=728&h=90'

export function partnerLink(key = 'default'): string {
  return PARTNER_LINKS[key] ?? PARTNER_LINKS.default
}
