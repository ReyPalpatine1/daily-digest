// 제휴 광고 링크 상수. 서버(email-templates, ad-click 라우트)와 클라이언트 모두에서 사용 가능.
// 향후 카테고리별 링크는 이 맵에 키를 추가한다 — 지금은 default(골드박스)만.
export const PARTNER_LINKS: Record<string, string> = {
  default: 'https://link.coupang.com/a/fqcYgp1Ike', // 골드박스(상시)
  banner: 'https://link.coupang.com/a/fq9z7BzDz2', // 골드박스 배너(HTML 태그형)
  // 카테고리 배너 5종 목적지(ad-click dest 리다이렉트용) — PARTNER_BANNERS와 동일 링크.
  goldbox: 'https://link.coupang.com/a/fq9z7BzDz2',
  books: 'https://link.coupang.com/a/frhnuS7L64',
  fresh: 'https://link.coupang.com/a/frhpztA1xA',
  wow: 'https://link.coupang.com/a/frhulT7R2O',
  elec: 'https://link.coupang.com/a/frhr4LpQho',
}

// 쿠팡 발급 카테고리 배너 5종(728x90). 발급값 그대로 — 수정 금지.
export type PartnerBanner = { key: string; link: string; img: string }
export const PARTNER_BANNERS: PartnerBanner[] = [
  { key: 'goldbox', link: 'https://link.coupang.com/a/fq9z7BzDz2', img: 'https://ads-partners.coupang.com/banners/1007442?trackingCode=AF5185528&subId=&traceId=V0-301-969b06e95b87326d-I1007442&w=728&h=90' },
  { key: 'books',   link: 'https://link.coupang.com/a/frhnuS7L64', img: 'https://ads-partners.coupang.com/banners/1007489?trackingCode=AF5185528&subId=&traceId=V0-301-f5c692db558def48-I1007489&w=728&h=90' },
  { key: 'fresh',   link: 'https://link.coupang.com/a/frhpztA1xA', img: 'https://ads-partners.coupang.com/banners/1007490?trackingCode=AF5185528&subId=&traceId=V0-301-371ae01f4226dec2-I1007490&w=728&h=90' },
  { key: 'wow',     link: 'https://link.coupang.com/a/frhulT7R2O', img: 'https://ads-partners.coupang.com/banners/1007488?trackingCode=AF5185528&subId=&traceId=V0-301-bae0f72e5e59e45f-I1007488&w=728&h=90' },
  { key: 'elec',    link: 'https://link.coupang.com/a/frhr4LpQho', img: 'https://ads-partners.coupang.com/banners/1007492?trackingCode=AF5185528&subId=&traceId=V0-301-5f9bd61900e673c0-I1007492&w=728&h=90' },
]

// 날짜(day of month)로 배너 순환 — 음수도 안전하게 정규화.
export function partnerBannerByDay(day: number): PartnerBanner {
  return PARTNER_BANNERS[((day % PARTNER_BANNERS.length) + PARTNER_BANNERS.length) % PARTNER_BANNERS.length]
}

export function partnerLink(key = 'default'): string {
  return PARTNER_LINKS[key] ?? PARTNER_LINKS.default
}
