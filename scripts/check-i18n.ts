// i18n 사전 검수 스크립트 (앱 런타임과 무관 — 개발자용 도구).
//
// 실행: npm run check:i18n
//   package.json이 tsc로 이 파일만 .tmp-i18n/에 컴파일한 뒤 node로 돌린다.
//   (tsx·ts-node를 새로 설치하지 않기 위한 구성. tsconfig에서 scripts/는 제외되어
//    앱 빌드 타입체크·배포 번들에는 들어가지 않는다.)
//
// 사전을 문자열로 파싱하지 않고 import한다 — 실제 런타임이 읽는 값과 같은 것을 본다.
//
// 종료 코드: 오류(키 누락·잉여 키·플레이스홀더 불일치)가 하나라도 있으면 1, 아니면 0.
//   미번역 의심·문체·마침표는 사람의 판단이 필요한 '경고'라 빌드를 막지 않는다.

import { translations } from '../lib/i18n/translations'
import { emailTranslations } from '../lib/i18n/email-translations'

type Locale = 'ko' | 'en' | 'zh' | 'ja'

const BASE: Locale = 'ko'
const TARGETS: Locale[] = ['en', 'zh', 'ja']

// (3) 미번역 의심에서 제외할 고유명사·브랜드·약어.
// 이 단어들만으로 이루어진 값은 네 언어에서 똑같은 것이 정상이다
// (예: stats.proOnly는 4개 언어 모두 'Pro'). 값에서 이 단어들을 모두 빼고 나서
// 글자(한글·영문·가나·한자)가 하나도 남지 않으면 "고유명사뿐"으로 보고 건너뛴다.
const PROPER_NOUNS = [
  'Daily Video Digest',
  'YouTube', 'Telegram', 'WhatsApp', 'KakaoTalk', 'LINE', 'Coupang', 'Gold Box',
  'Gemini', 'Supabase', 'Cloudflare',
  'Pro', 'PRO', 'Free', 'FREE', 'VIP', 'ADMIN', 'AI', 'AD', 'CTA', 'ID', 'URL',
]

// (4) '합니다'체 통일 규칙을 어긴 종결어미.
const CASUAL_ENDINGS = ['해요', '이에요', '어요', '드릴게요', '봐요']

// (5) 한국어 서술어 종결 음절 (마침표 규칙 판정용)
const PREDICATE_TAIL = ['다', '요', '까']

type Finding = { dict: string; path: string; detail: string }

// ── 사전 평탄화 ────────────────────────────────────────────────
// 중첩 객체와 배열을 모두 재귀 순회해 "키경로 → 문자열" 맵으로 만든다.
// 배열은 pricing.freeFeatures[0] 처럼 인덱스를 붙이고, faq처럼 객체 배열도 그대로 파고든다.
// 문자열이 아닌 값(숫자·불린 등)은 문구가 아니므로 대상에서 제외한다.
function flatten(node: unknown, path: string, out: Map<string, string>): void {
  if (typeof node === 'string') {
    out.set(path, node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => flatten(v, path + '[' + i + ']', out))
    return
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      flatten(v, path ? path + '.' + k : k, out)
    }
  }
}

// ── 판정 헬퍼 ──────────────────────────────────────────────────
// 값에서 고유명사를 모두 제거한 뒤 글자가 남는지 검사
function isProperNounOnly(value: string): boolean {
  let rest = value
  for (const noun of PROPER_NOUNS) rest = rest.split(noun).join('')
  return !/[a-zA-Zㄱ-ㆎ가-힣぀-ヿ一-鿿]/.test(rest)
}

// {name} 형태 토큰 집합 추출 (중복 제거 후 정렬 → 순서 차이는 불일치로 보지 않음)
function placeholders(value: string): string[] {
  const found = value.match(/\{(\w+)\}/g) || []
  return Array.from(new Set(found)).sort()
}

function hasHangul(value: string): boolean {
  return /[가-힣]/.test(value)
}

// ── 검사 결과 보관함 ───────────────────────────────────────────
type Buckets = {
  missing: Finding[]      // (1) ko에 있는데 대상 언어에 없음
  extra: Finding[]        // (2) 대상 언어에만 있음
  untranslated: Finding[] // (3) 값이 ko와 완전히 동일
  casual: Finding[]       // (4) 해요체
  period: Finding[]       // (5) 마침표 규칙 위반 의심
  placeholder: Finding[]  // (6) 플레이스홀더 불일치
}

function checkDict(dictName: string, dict: Record<string, unknown>, b: Buckets): void {
  const base = new Map<string, string>()
  flatten(dict[BASE], '', base)

  // (4)(5) — ko 값 자체 검사
  base.forEach((value, path) => {
    const trimmed = value.trim()
    if (!trimmed) return

    // (4) 해요체: 종결어미 + 선택적 문장부호로 끝나는가
    for (const ending of CASUAL_ENDINGS) {
      if (new RegExp(ending + '[.!?]?$').test(trimmed)) {
        b.casual.push({ dict: dictName, path, detail: "'" + ending + "'로 끝남 → " + trimmed })
        break
      }
    }

    // (5) 마침표 규칙 — 오탐이 있을 수 있어 경고로만 낸다.
    //     여러 줄·HTML이 섞인 값은 판정에서 제외해 소음을 줄인다.
    if (hasHangul(trimmed) && trimmed.indexOf('\n') === -1 && trimmed.indexOf('<') === -1) {
      const endsWithPeriod = trimmed.slice(-1) === '.'
      const core = endsWithPeriod ? trimmed.slice(0, -1) : trimmed
      const last = core.slice(-1)
      const isPredicate = PREDICATE_TAIL.indexOf(last) !== -1
      if (isPredicate && !endsWithPeriod) {
        b.period.push({ dict: dictName, path, detail: '서술어 종결인데 마침표 없음 → ' + trimmed })
      } else if (!isPredicate && endsWithPeriod && /[가-힣]/.test(last)) {
        b.period.push({ dict: dictName, path, detail: '명사 종결인데 마침표 있음 → ' + trimmed })
      }
    }
  })

  // (1)(2)(3)(6) — 대상 언어 대조
  for (const locale of TARGETS) {
    const target = new Map<string, string>()
    flatten(dict[locale], '', target)

    base.forEach((koValue, path) => {
      const value = target.get(path)
      if (value === undefined) {
        b.missing.push({ dict: dictName, path: locale + ': ' + path, detail: 'ko="' + koValue + '"' })
        return
      }

      // (3) 미번역 의심
      if (value === koValue && !isProperNounOnly(value)) {
        b.untranslated.push({ dict: dictName, path: locale + ': ' + path, detail: value })
      }

      // (6) 플레이스홀더 불일치 — 런타임에 값이 안 채워지는 실제 버그
      const koTokens = placeholders(koValue)
      const tokens = placeholders(value)
      if (koTokens.join(',') !== tokens.join(',')) {
        b.placeholder.push({
          dict: dictName,
          path: locale + ': ' + path,
          detail: 'ko=[' + (koTokens.join(' ') || '없음') + '] vs ' + locale + '=[' + (tokens.join(' ') || '없음') + ']',
        })
      }
    })

    target.forEach((value, path) => {
      if (!base.has(path)) {
        b.extra.push({ dict: dictName, path: locale + ': ' + path, detail: value })
      }
    })
  }
}

// ── 출력 ───────────────────────────────────────────────────────
function report(title: string, findings: Finding[], isError: boolean): void {
  const mark = findings.length === 0 ? 'OK  ' : isError ? 'FAIL' : 'WARN'
  console.log('\n[' + mark + '] ' + title + ' — ' + findings.length + '건')
  for (const f of findings) {
    console.log('   [' + f.dict + '] ' + f.path + ' : ' + f.detail)
  }
}

function main(): void {
  const b: Buckets = { missing: [], extra: [], untranslated: [], casual: [], period: [], placeholder: [] }

  checkDict('translations.ts', translations as unknown as Record<string, unknown>, b)
  checkDict('email-translations.ts', emailTranslations as unknown as Record<string, unknown>, b)

  const line = '='.repeat(72)
  console.log(line)
  console.log('i18n 사전 검수 — 기준 언어: ko / 대상: en, zh, ja')
  console.log(line)

  console.log('\n──────── 오류 (하나라도 있으면 exit 1) ────────')
  report('(1) 키 누락 — ko에 있는데 대상 언어에 없음', b.missing, true)
  report('(2) 잉여 키 — 대상 언어에만 있음(삭제 누락)', b.extra, true)
  report('(6) 플레이스홀더 불일치 — 런타임에 값이 안 채워짐', b.placeholder, true)

  console.log('\n──────── 경고 (exit 0, 사람의 판단 필요) ────────')
  report('(3) 미번역 의심 — 값이 ko와 완전히 동일', b.untranslated, false)
  report("(4) 문체 위반 — '합니다'체가 아닌 ko 문구", b.casual, false)
  report('(5) 마침표 규칙 위반 의심 — 오탐 가능', b.period, false)

  const errors = b.missing.length + b.extra.length + b.placeholder.length
  const warnings = b.untranslated.length + b.casual.length + b.period.length

  console.log('\n' + line)
  console.log('요약')
  console.log('  (1) 키 누락            : ' + b.missing.length)
  console.log('  (2) 잉여 키            : ' + b.extra.length)
  console.log('  (6) 플레이스홀더 불일치 : ' + b.placeholder.length)
  console.log('  ── 오류 합계           : ' + errors)
  console.log('  (3) 미번역 의심        : ' + b.untranslated.length)
  console.log('  (4) 문체 위반          : ' + b.casual.length)
  console.log('  (5) 마침표 의심        : ' + b.period.length)
  console.log('  ── 경고 합계           : ' + warnings)
  console.log(line)

  process.exit(errors > 0 ? 1 : 0)
}

main()
