// 토스 카드사 코드(issuerCode) → 표시용 카드사명.
// 출처: 토스페이먼츠 개발자센터 '카드사 코드'(https://docs.tosspayments.com/reference/codes).
//
// ※ 코드는 숫자만이 아니다('W1','3K','3A','PCP','KBS' 등) — 반드시 문자열로 다룰 것.
//   숫자로 파싱하면 'W1'이 NaN이 되고 '11'과 '011'이 뒤섞인다.
export const TOSS_ISSUER_NAMES: Record<string, string> = {
  // 국내
  '3K': '기업 BC',
  '46': '광주은행',
  '71': '롯데카드',
  '30': '한국산업은행',
  '31': 'BC카드',
  '51': '삼성카드',
  '38': '새마을금고',
  '41': '신한카드',
  '62': '신협',
  '36': '씨티카드',
  '33': '우리BC카드',
  'W1': '우리카드',
  '37': '우체국예금보험',
  '39': '저축은행중앙회',
  '35': '전북은행',
  '42': '제주은행',
  '15': '카카오뱅크',
  '3A': '케이뱅크',
  '24': '토스뱅크',
  '21': '하나카드',
  '61': '현대카드',
  '11': 'KB국민카드',
  '91': 'NH농협카드',
  '34': 'Sh수협은행',
  'PCP': '페이코',
  'KBS': 'KB증권',
  // 해외
  '6D': '다이너스 클럽',
  '4M': '마스터카드',
  '3C': '유니온페이',
  '7A': '아메리칸 익스프레스',
  '4J': 'JCB',
  '4V': 'VISA',
}

// 카드 표시명 — 'KB국민카드 **** 7508' 형태.
//
// 카드번호 원문은 만들지도 저장하지도 않는다. 토스가 주는 number는 이미 마스킹된 값이고
// 거기서 마지막 4글자를 원문 그대로 쓴다.
// 숫자만 추출해 자르면 마스킹 위치에 따라 엉뚱한 번호가 만들어진다
// (예: '12345678****123*' → 앞자리가 섞여 '8123'이 된다).
// 그래서 숫자든 '*'든 가리지 않고 끝 4글자를 그대로 가져온다 — 지어낸 값이 아니므로
// 거짓 표시가 아니고, 카드마다 번호가 보였다 안 보였다 하지도 않는다.
// 4글자에 못 미치는 번호면 카드사명만 남긴다.
// 표에 없는 코드는 이름 대신 코드를 그대로 남긴다 — 새 카드사가 생겨도 정보를 잃지 않는다.
export function buildCardLabel(card?: { issuerCode?: string; number?: string } | null): string | null {
  if (!card) return null
  const number = card.number ?? ''
  const tail = number.length >= 4 ? number.slice(-4) : ''
  const code = (card.issuerCode ?? '').trim().toUpperCase()
  const issuer = code ? (TOSS_ISSUER_NAMES[code] ?? code) : ''
  if (!issuer && !tail) return null
  return [issuer, tail ? `**** ${tail}` : ''].filter(Boolean).join(' ')
}
