// 이메일 다국어 사전. UI 의 translations.ts 와 분리 — 이메일은 서버에서 발송되고
// 라벨 톤(메일 컨텍스트)이 달라 별도 관리한다.

export const emailTranslations = {
  ko: {
    digest: {
      subject: '[Daily Digest] {date} 오늘의 유튜브 요약',
      greeting: '안녕하세요!',
      summary: '오늘 {count}개의 영상을 요약했어요',
      breaking: '🚨 속보',
      keyPoints: '📌 핵심 포인트',
      timeline: '⏱ 주요 타임라인',
      watchVideo: '▶ 영상 보기',
      tagline: '어제의 유튜브를 한눈에',
      manageLink: '알림 설정',
      unsubscribe: '구독 해지',
      noVideos: '오늘은 새 영상이 없어요',
      emptySubject: '[Daily Digest] {date} — 어제는 새 영상이 없었어요',
      emptyBody: '구독하신 채널에 어제 올라온 새 영상이 없었어요. 내일 다시 정리해 보내드릴게요!',
      footer: '이 이메일은 Daily Digest에서 발송되었습니다',
      sentTo: '{email} 님에게 발송된 메일입니다',
      uploadedAt: '업로드',
      summaryUnavailable: '요약을 제공할 수 없는 영상이에요',
      basisTranscript: '자막을 기반으로 분석한 요약입니다',
      basisDescription: '영상 설명을 기반으로 분석한 요약입니다',
      basisTitle: '제목을 기반으로 한 간략 요약입니다',
    },
    breaking: {
      subject: '[속보] {title}',
      heading: '🚨 속보가 도착했어요',
      channel: '채널',
      publishedAt: '게시 시각',
      summary: '요약',
      keyPoints: '📌 핵심 포인트',
      watchVideo: '▶ 영상 보기',
    },
    error: {
      subject: '[Daily Digest] 시스템 알림',
      heading: '⚠️ 오류 알림',
      message: '다음 오류가 발생했습니다',
      time: '시간',
      action: '확인 필요',
    },
    welcome: {
      subject: '🎉 Daily Digest에 오신 것을 환영합니다',
      heading: '환영합니다!',
      desc: '매일 아침 구독한 유튜브 채널의 영상을 요약해서 보내드릴게요',
      startCta: '채널 추가하러 가기',
    },
  },
  en: {
    digest: {
      subject: '[Daily Digest] Your YouTube Summary for {date}',
      greeting: 'Hello!',
      summary: 'Summarized {count} videos today',
      breaking: '🚨 Breaking',
      keyPoints: '📌 Key Points',
      timeline: '⏱ Timeline',
      watchVideo: '▶ Watch Video',
      tagline: "Yesterday's YouTube at a glance",
      manageLink: 'Notification settings',
      unsubscribe: 'Unsubscribe',
      noVideos: 'No new videos today',
      emptySubject: '[Daily Digest] No new videos for {date}',
      emptyBody: 'None of your subscribed channels uploaded a new video yesterday. We\'ll be back tomorrow with your digest!',
      footer: 'This email was sent by Daily Digest',
      sentTo: 'Sent to {email}',
      uploadedAt: 'Uploaded',
      summaryUnavailable: 'Summary unavailable for this video',
      basisTranscript: 'Summary based on the video transcript',
      basisDescription: 'Summary based on the video description',
      basisTitle: 'Brief summary based on the title only',
    },
    breaking: {
      subject: '[Breaking] {title}',
      heading: '🚨 Breaking News',
      channel: 'Channel',
      publishedAt: 'Published',
      summary: 'Summary',
      keyPoints: '📌 Key Points',
      watchVideo: '▶ Watch Video',
    },
    error: {
      subject: '[Daily Digest] System Alert',
      heading: '⚠️ Error Alert',
      message: 'The following error occurred',
      time: 'Time',
      action: 'Action Required',
    },
    welcome: {
      subject: '🎉 Welcome to Daily Digest',
      heading: 'Welcome!',
      desc: 'Every morning, we summarize videos from your subscribed YouTube channels',
      startCta: 'Add Channels',
    },
  },
}

export type EmailLocale = keyof typeof emailTranslations

export function et(
  locale: EmailLocale,
  key: string,
  params?: Record<string, string | number>
): string {
  const keys = key.split('.')
  let value: any = emailTranslations[locale] ?? emailTranslations.ko
  for (const k of keys) {
    value = value?.[k]
    if (value === undefined) return key
  }
  if (typeof value !== 'string') return key
  if (params) {
    return value.replace(/\{(\w+)\}/g, (_, paramKey) =>
      String(params[paramKey] ?? `{${paramKey}}`)
    )
  }
  return value
}
