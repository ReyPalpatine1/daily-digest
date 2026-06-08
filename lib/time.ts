// 시각 처리 통합 유틸 (1단계).
//
// 기본 원칙:
//   - 저장/계산: UTC (Date 객체는 항상 UTC 시점을 나타냄)
//   - 표시: KST(기본) 또는 사용자 타임존
//   - 지금은 한국 사용자만 → 기본값 'Asia/Seoul'
//   - 글로벌 진출 시 timeZone 파라미터만 사용자별 값으로 넘기면 됨
//
// 주의: 한국(KST)은 DST(서머타임)가 없어 항상 UTC+9 고정이지만,
//       아래 함수들은 Intl 기반이라 DST가 있는 타임존에서도 (거의) 정확히 동작한다.

const KST = 'Asia/Seoul'

// 타임존의 벽시계 시각 구성요소
export type ZonedParts = {
  year: number
  month: number // 1~12
  day: number
  hour: number // 0~23
  minute: number
  second: number
}

// 현재 UTC 시각.
// new Date()를 직접 쓰지 말고 이 함수를 쓰면 의도가 드러나고 테스트도 쉬워진다.
export function nowUtc(): Date {
  return new Date()
}

// UTC Date → 특정 타임존의 "벽시계 시각" 구성요소로 변환.
// 예: 2026-06-07T00:30:00Z → KST { year:2026, month:6, day:7, hour:9, minute:30, second:0 }
export function toZoned(utc: Date, timeZone = KST): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23', // 자정을 24시가 아닌 0시로 (일부 환경의 "24:00" 방지)
  }).formatToParts(utc)

  const map = Object.fromEntries(
    parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  ) as Record<string, string>

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

// 특정 타임존의 "벽시계 시각"(year/month/day/hour/...)을 UTC 시점으로 변환.
// 표준적인 추정-보정 기법: 벽시계 값을 일단 UTC로 가정해 instant를 만든 뒤,
// 그 instant가 해당 타임존에서 어떻게 보이는지로 오프셋을 역산해 보정한다.
// (고정 오프셋 타임존에선 정확, DST 경계에서도 사실상 정확)
export function zonedToUtc(parts: ZonedParts, timeZone = KST): Date {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  const back = toZoned(new Date(guess), timeZone)
  const backMs = Date.UTC(
    back.year,
    back.month - 1,
    back.day,
    back.hour,
    back.minute,
    back.second
  )
  const offset = backMs - guess // 해당 타임존의 UTC 오프셋(ms)
  return new Date(guess - offset)
}

// 특정 타임존 기준 "오늘 자정(00:00)"을 UTC Date로.
// 예: KST 2026-06-07 00:00 → 2026-06-06T15:00:00Z
export function startOfDayUtc(timeZone = KST, baseUtc: Date = new Date()): Date {
  const z = toZoned(baseUtc, timeZone)
  return zonedToUtc(
    { year: z.year, month: z.month, day: z.day, hour: 0, minute: 0, second: 0 },
    timeZone
  )
}

// 특정 타임존 기준 "어제 0시 ~ 오늘 0시" 범위를 UTC로.
// getYesterdayVideos의 publishedAfter/Before 산출용.
export function yesterdayRangeUtc(
  timeZone = KST,
  baseUtc: Date = new Date()
): { start: Date; end: Date } {
  const end = startOfDayUtc(timeZone, baseUtc) // 오늘 0시
  // 오늘 0시 직전(1초 전)의 날짜로 다시 자정을 구하면 DST에도 안전하게 "어제 0시"가 나온다.
  const start = startOfDayUtc(timeZone, new Date(end.getTime() - 1000))
  return { start, end }
}

// send_time("HH:MM", 사용자 타임존 기준)이 현재 cron 슬롯에 해당하는지 판정.
// slotMinutes: cron 주기(예: 15분). 예) "07:00", slot 15 → KST 07:00~07:14 에 true.
export function isSendTimeSlot(
  sendTime: string,
  timeZone = KST,
  slotMinutes = 15,
  baseUtc: Date = new Date()
): boolean {
  if (!/^\d{2}:\d{2}$/.test(sendTime.trim())) return false
  const [sendH, sendM] = sendTime.trim().split(':').map(Number)
  const sendMinutes = sendH * 60 + sendM

  const z = toZoned(baseUtc, timeZone)
  const nowMinutes = z.hour * 60 + z.minute

  return nowMinutes >= sendMinutes && nowMinutes < sendMinutes + slotMinutes
}

// 현재 시각(사용자 타임존)이 send_time을 "지났는지" (당일 기준).
// 좁은 슬롯 매칭(isSendTimeSlot) 대신 이 "경과 + 멱등성" 방식을 쓰면,
// GitHub Actions cron이 1~5시간 밀려 15분 슬롯을 놓쳐도 그날 처음 도는
// cron에서 발송된다. 하루 1회 보장은 호출부의 tryStartScheduled(send_log)가 담당.
// 예) send "11:00" → KST 11:00 이후 어떤 시각에도 true.
export function isSendTimePassed(
  sendTime: string,
  timeZone = KST,
  baseUtc: Date = new Date()
): boolean {
  if (!/^\d{2}:\d{2}$/.test(sendTime.trim())) return false
  const [sendH, sendM] = sendTime.trim().split(':').map(Number)
  const sendMinutes = sendH * 60 + sendM

  const z = toZoned(baseUtc, timeZone)
  const nowMinutes = z.hour * 60 + z.minute

  return nowMinutes >= sendMinutes
}

// send_time을 지난 지 maxLateMinutes를 "초과"했는지 (당일 기준).
// 아침 발송분이 cron 폭주로 저녁에 가는 것을 막는 안전장치. true면 너무 늦어 skip.
// (isSendTimePassed가 이미 true인 상황에서만 의미가 있다 — 둘 다 당일 KST 분 단위 비교)
export function isTooLateToSend(
  sendTime: string,
  maxLateMinutes: number,
  timeZone = KST,
  baseUtc: Date = new Date()
): boolean {
  if (!/^\d{2}:\d{2}$/.test(sendTime.trim())) return false
  const [sendH, sendM] = sendTime.trim().split(':').map(Number)
  const sendMinutes = sendH * 60 + sendM

  const z = toZoned(baseUtc, timeZone)
  const nowMinutes = z.hour * 60 + z.minute

  return nowMinutes - sendMinutes > maxLateMinutes
}

// 표시용: UTC → KST 날짜 문자열 (예: "2026년 6월 7일" / "June 7, 2026")
export function formatDateKst(utc: Date, locale = 'ko'): string {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    timeZone: KST,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(utc)
}

// 표시용: "N시간 전" 상대 시각.
export function timeAgo(utc: Date, locale = 'ko', baseUtc: Date = new Date()): string {
  const ms = baseUtc.getTime() - utc.getTime()
  const ko = locale === 'ko'

  if (ms < 60_000) return ko ? '방금 전' : 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return ko ? `${min}분 전` : `${min} min ago`
  const hour = Math.floor(min / 60)
  if (hour < 24) return ko ? `${hour}시간 전` : `${hour} hr ago`
  const day = Math.floor(hour / 24)
  if (day < 7) return ko ? `${day}일 전` : `${day} day${day > 1 ? 's' : ''} ago`
  const week = Math.floor(day / 7)
  if (week < 4) return ko ? `${week}주 전` : `${week} week${week > 1 ? 's' : ''} ago`
  const month = Math.floor(day / 30)
  if (month < 12) return ko ? `${month}개월 전` : `${month} month${month > 1 ? 's' : ''} ago`
  const year = Math.floor(day / 365)
  return ko ? `${year}년 전` : `${year} year${year > 1 ? 's' : ''} ago`
}

// UTC → 특정 타임존의 날짜 키 "YYYY-MM-DD" (멱등성 키/날짜 비교용).
// 예: 2026-06-06T15:00:00Z → KST "2026-06-07"
export function dateKey(utc: Date, timeZone = KST): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(utc)
}
