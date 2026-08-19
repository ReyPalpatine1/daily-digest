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
//   미번역 의심·문체·마침표·종결 부호는 사람의 판단이 필요한 '경고'라 빌드를 막지 않는다.

import { translations } from '../lib/i18n/translations'
import { emailTranslations } from '../lib/i18n/email-translations'

type Locale = 'ko' | 'en' | 'zh' | 'ja'

const BASE: Locale = 'ko'
const TARGETS: Locale[] = ['en', 'zh', 'ja']

// (3) 미번역 의심에서 제외할 고유명사·브랜드·업계 약어.
// 번역 대상이 아닌 고유명사·업계 약어 — 오탐이 늘면 여기 추가할 것.
// 이 단어들만으로 이루어진 값은 네 언어에서 똑같은 것이 정상이다
// (예: stats.proOnly는 4개 언어 모두 'Pro').
// 판정은 완전 일치가 아니라 포함 검사다 — 값에서 괄호·공백·기호를 지우고 이 단어들을
// 모두 빼고 나서 글자(한글·영문·가나·한자)가 남지 않으면 "고유명사뿐"으로 보고 건너뛴다.
//   · 'CVC'는 실물 카드에 그대로 인쇄된 표기라 번역하면 사용자가 못 찾는다.
//   · 'DAU'·'MAU'는 관리자 화면의 업계 표준 지표 약어다.
//   · 'AI Studio'는 'AI'보다 먼저 지워져야 하므로 아래에서 긴 것부터 정렬해 제거한다.
const PROPER_NOUNS = [
  'Daily Video Digest',
  'YouTube', 'Telegram', 'WhatsApp', 'KakaoTalk', 'LINE', 'Coupang', 'Gold Box',
  'Gemini', 'Supabase', 'Cloudflare', 'Google Cloud Console', 'AI Studio',
  'Chat ID', 'DAU', 'MAU', 'CVC',
  'Pro', 'PRO', 'Free', 'FREE', 'VIP', 'ADMIN', 'AI', 'AD', 'CTA', 'ID', 'URL',
]

// (4) '합니다'체 통일 규칙을 어긴 종결어미.
const CASUAL_ENDINGS = ['해요', '이에요', '어요', '드릴게요', '봐요']

// (4)(5) 두 검사에서 모두 제외할 키 — FAQ의 질문(.q).
//   문체: 사용자가 실제로 할 법한 구어체여야 하고, 답변이 정중체라 대비도 자연스럽다.
//   마침표: 물음 형태의 제목류라 화면에서도 마침표 없이 표시된다.
// 어느 쪽도 규칙 위반이 아니라 의도된 표기다.
// 답변(.a)은 두 검사 모두 계속 대상 — 답변은 '합니다'체 + 마침표가 맞다.
const FAQ_QUESTION_PATH = /faq\[\d+\]\.q$/

// (5) 한국어 서술어 종결 음절 (마침표 규칙 판정용)
const PREDICATE_TAIL = ['다', '요', '까']

// (5) 마침표 검사에서 제외할 키 이름 꼬리 — 제목·제목 줄에 마침표를 붙이지 않는 것은
// 관행이며 규칙 (1) "제목·라벨은 마침표 없음"에 해당한다(메일 제목 등).
const TITLE_KEY_SUFFIXES = ['subject', 'heading']

// (5) 마침표 검사에서 제외할 빈 상태 라벨 키 꼬리.
// 빈 상태 라벨(목록이 비었을 때 뜨는 표시)은 문장이 아니라 라벨이므로 마침표를 붙이지 않는다.
// en/zh/ja 세 언어도 공통으로 종결 부호를 쓰지 않는다.
// ※ 'empty'/'noMatch'로 정확히 끝나는 키만 대상이다 — 'emptyDesc'는 안내 문장이라 계속 검사한다.
// ※ (7) 종결 부호 검사에는 이 예외를 넣지 않는다. (7)은 "ko에 부호가 없으면 다른 언어에도
//    없어야 한다"를 보므로 네 언어가 모두 부호 없는 현재 상태에서 이미 통과한다 —
//    예외를 넣으면 검사만 약해진다.
const EMPTY_STATE_KEY_SUFFIXES = ['empty', 'nomatch']

// (5) 마침표 검사에서 제외할 명사형 종결.
// 검출기가 마지막 "음절"만 보기 때문에 '확인 필요'·'Pro 업그레이드 필요'처럼
// '요'로 끝나는 명사구를 서술어로 오인한다 → 명사형으로 끝나면 판정 자체를 건너뛴다.
const NOUN_ENDINGS = ['필요', '가능', '완료', '중', '없음', '있음']

// (7) 언어별 문장 종결 부호.
// (5)는 한국어 값만 보므로 다른 언어에서 종결 부호가 빠져도 잡히지 않는다.
// (7)은 ko를 기준으로 삼아 "ko에 종결 부호가 있으면 대상 언어에도 있어야 하고,
// 없으면 대상 언어에도 없어야 한다"를 대조한다.
// 중국어·일본어는 전각 부호(。！？)를 쓴다 — ASCII 마침표로 끝나면 어긋난 것으로 본다.
// 물음표·느낌표는 서로 대응만 되면 통과시킨다(ko '…나요?' ↔ zh '…？').
const TERMINAL_PUNCT: Record<Locale, string[]> = {
  ko: ['.', '!', '?'],
  en: ['.', '!', '?'],
  zh: ['。', '！', '？'],
  ja: ['。', '！', '？'],
}

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
// 괄호·공백·기호를 지우고 글자와 숫자만 남긴다.
// 'Gemini (AI Studio)' → 'GeminiAIStudio' 처럼 표기 차이를 없애고 비교하기 위함.
function lettersOnly(value: string): string {
  return value.replace(/[^0-9A-Za-zㄱ-ㆎ가-힣぀-ヿ一-鿿]/g, '')
}

// 긴 고유명사부터 지운다 — 'AI'가 먼저 지워지면 'AI Studio'가 'Studio'만 남아 오탐이 된다.
const PROPER_NOUNS_STRIPPED = PROPER_NOUNS
  .map(lettersOnly)
  .filter(function (n) { return n.length > 0 })
  .sort(function (a, b) { return b.length - a.length })

// 값이 고유명사 조합만으로 이루어져 있는지 (미번역 판정에서 제외할지) 검사.
function isProperNounOnly(value: string): boolean {
  let rest = lettersOnly(value)
  if (!rest) return true // 기호·숫자뿐인 값(예: '10:30')은 번역 대상이 아니다
  for (const noun of PROPER_NOUNS_STRIPPED) rest = rest.split(noun).join('')
  return !/[a-zA-Zㄱ-ㆎ가-힣぀-ヿ一-鿿]/.test(rest)
}

// (5) 제목류 키인지 — 키 경로의 마지막 조각이 subject/heading으로 끝나는가.
function isTitleKey(path: string): boolean {
  const parts = path.split('.')
  const leaf = (parts[parts.length - 1] || '').toLowerCase()
  for (const suffix of TITLE_KEY_SUFFIXES) {
    if (leaf.length >= suffix.length && leaf.slice(-suffix.length) === suffix) return true
  }
  return false
}

// (5) 빈 상태 라벨 키인지 — 키 경로의 마지막 조각이 empty/noMatch로 끝나는가.
function isEmptyStateKey(path: string): boolean {
  const parts = path.split('.')
  const leaf = (parts[parts.length - 1] || '').toLowerCase()
  for (const suffix of EMPTY_STATE_KEY_SUFFIXES) {
    if (leaf.length >= suffix.length && leaf.slice(-suffix.length) === suffix) return true
  }
  return false
}

// (5) 명사형으로 끝나는 값인지 (서술어 오인 방지)
function endsWithNounForm(core: string): boolean {
  for (const ending of NOUN_ENDINGS) {
    if (core.length >= ending.length && core.slice(-ending.length) === ending) return true
  }
  return false
}

// (7) 말줄임표로 끝나는 값인지 — ASCII('...')와 전각('…') 모두 인정.
// 진행 중 표시('불러오는 중...')는 문장이 아니라 상태 표기라 언어를 막론하고 말줄임표로 끝난다.
// zh/ja 종결 부호에 ASCII '.'를 넣어 버리면 평서문의 마침표 누락까지 통과하므로,
// 마침표가 아니라 "말줄임표"만 예외로 둔다.
function endsWithEllipsis(value: string): boolean {
  const t = value.trim()
  return t.slice(-3) === '...' || t.slice(-1) === '…'
}

// (7) 값이 해당 언어의 종결 부호로 끝나면 그 부호를, 아니면 null을 돌려준다.
function terminalPunct(value: string, locale: Locale): string | null {
  const last = value.trim().slice(-1)
  return TERMINAL_PUNCT[locale].indexOf(last) !== -1 ? last : null
}

// (7) 종결 부호 검사에서 제외할 항목인지 — 제외 규칙은 (5)와 같은 것을 그대로 쓴다
// (FAQ 질문 / 제목류 키 / 고유명사뿐인 값). 새 규칙을 만들지 않는다.
function skipTerminalCheck(path: string, koValue: string, value: string): boolean {
  if (FAQ_QUESTION_PATH.test(path)) return true
  if (isTitleKey(path)) return true
  if (isProperNounOnly(koValue) || isProperNounOnly(value)) return true
  return false
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
  terminal: Finding[]     // (7) 종결 부호가 ko와 어긋남
}

function checkDict(dictName: string, dict: Record<string, unknown>, b: Buckets): void {
  const base = new Map<string, string>()
  flatten(dict[BASE], '', base)

  // (4)(5) — ko 값 자체 검사
  base.forEach((value, path) => {
    const trimmed = value.trim()
    if (!trimmed) return

    // (4) 해요체: 종결어미 + 선택적 문장부호로 끝나는가.
    //     FAQ 질문(.q)은 의도된 구어체라 제외한다.
    if (!FAQ_QUESTION_PATH.test(path)) {
      for (const ending of CASUAL_ENDINGS) {
        if (new RegExp(ending + '[.!?]?$').test(trimmed)) {
          b.casual.push({ dict: dictName, path, detail: "'" + ending + "'로 끝남 → " + trimmed })
          break
        }
      }
    }

    // (5) 마침표 규칙 — 오탐이 있을 수 있어 경고로만 낸다.
    //     여러 줄·HTML이 섞인 값, 제목류 키(subject·heading), FAQ 질문(.q),
    //     빈 상태 라벨(empty·noMatch)은 판정에서 제외해 소음을 줄인다.
    if (
      hasHangul(trimmed) && trimmed.indexOf('\n') === -1 && trimmed.indexOf('<') === -1 &&
      !isTitleKey(path) && !FAQ_QUESTION_PATH.test(path) && !isEmptyStateKey(path)
    ) {
      const endsWithPeriod = trimmed.slice(-1) === '.'
      const core = endsWithPeriod ? trimmed.slice(0, -1) : trimmed
      const last = core.slice(-1)
      // 명사형 종결('… 필요' 등)은 서술어로 오인되므로 판정 자체를 건너뛴다.
      if (!endsWithNounForm(core)) {
        const isPredicate = PREDICATE_TAIL.indexOf(last) !== -1
        if (isPredicate && !endsWithPeriod) {
          b.period.push({ dict: dictName, path, detail: '서술어 종결인데 마침표 없음 → ' + trimmed })
        } else if (!isPredicate && endsWithPeriod && /[가-힣]/.test(last)) {
          b.period.push({ dict: dictName, path, detail: '명사 종결인데 마침표 있음 → ' + trimmed })
        }
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

      // (7) 종결 부호 일관성 — ko 기준으로 있고/없고가 같아야 한다.
      // 양쪽 다 말줄임표로 끝나면 종결 부호가 일치하는 것으로 본다.
      if (!skipTerminalCheck(path, koValue, value) && !(endsWithEllipsis(koValue) && endsWithEllipsis(value))) {
        const koEnd = terminalPunct(koValue, BASE)
        const targetEnd = terminalPunct(value, locale)
        if (koEnd && !targetEnd) {
          b.terminal.push({
            dict: dictName,
            path: locale + ': ' + path,
            detail: '대상 언어에 종결 부호 없음 → ' + koValue + ' ↔ ' + value,
          })
        } else if (!koEnd && targetEnd) {
          b.terminal.push({
            dict: dictName,
            path: locale + ': ' + path,
            detail: 'ko에는 없는 종결 부호 있음 → ' + koValue + ' ↔ ' + value,
          })
        }
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
  const b: Buckets = {
    missing: [], extra: [], untranslated: [], casual: [], period: [], placeholder: [], terminal: [],
  }

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
  report('(7) 종결 부호 불일치 — ko와 다른 언어의 문장 끝 부호가 어긋남', b.terminal, false)

  const errors = b.missing.length + b.extra.length + b.placeholder.length
  const warnings = b.untranslated.length + b.casual.length + b.period.length + b.terminal.length

  console.log('\n' + line)
  console.log('요약')
  console.log('  (1) 키 누락            : ' + b.missing.length)
  console.log('  (2) 잉여 키            : ' + b.extra.length)
  console.log('  (6) 플레이스홀더 불일치 : ' + b.placeholder.length)
  console.log('  ── 오류 합계           : ' + errors)
  console.log('  (3) 미번역 의심        : ' + b.untranslated.length)
  console.log('  (4) 문체 위반          : ' + b.casual.length)
  console.log('  (5) 마침표 의심        : ' + b.period.length)
  console.log('  (7) 종결 부호 불일치    : ' + b.terminal.length)
  console.log('  ── 경고 합계           : ' + warnings)
  console.log(line)

  process.exit(errors > 0 ? 1 : 0)
}

main()
