// 이메일 다국어 사전. UI 의 translations.ts 와 분리 — 이메일은 서버에서 발송되고
// 라벨 톤(메일 컨텍스트)이 달라 별도 관리한다.

export const emailTranslations = {
  ko: {
    digest: {
      subject: '[Daily Digest] {date} 오늘의 유튜브 요약',
      greeting: '안녕하세요!',
      summary: '오늘 {count}개의 영상을 요약했어요',
      openApp: '다이제스트 바로가기',
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
      footer: 'Daily Digest · 유튜브 요약 자동 발송',
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
    channels: {
      email: '이메일',
      telegram: '텔레그램',
      kakao: '카카오톡',
      whatsapp: 'WhatsApp',
      line: 'LINE',
    },
  },
  en: {
    digest: {
      subject: '[Daily Digest] Your YouTube Summary for {date}',
      greeting: 'Hello!',
      summary: 'Summarized {count} videos today',
      openApp: 'Go to Digest',
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
      footer: 'Daily Digest · Automated YouTube summaries',
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
    channels: {
      email: 'Email',
      telegram: 'Telegram',
      kakao: 'KakaoTalk',
      whatsapp: 'WhatsApp',
      line: 'LINE',
    },
  },
  zh: {
    digest: {
      subject: '[Daily Digest] {date} 今日 YouTube 摘要',
      greeting: '你好！',
      summary: '今天已总结 {count} 个视频',
      openApp: '打开摘要',
      breaking: '🚨 快讯',
      keyPoints: '📌 要点',
      timeline: '⏱ 主要时间线',
      watchVideo: '▶ 观看视频',
      tagline: '一眼看尽昨天的 YouTube',
      manageLink: '通知设置',
      unsubscribe: '取消订阅',
      noVideos: '今天没有新视频',
      emptySubject: '[Daily Digest] {date} — 昨天没有新视频',
      emptyBody: '你订阅的频道昨天没有上传新视频。我们明天会再为你整理发送！',
      footer: 'Daily Digest · 自动发送的 YouTube 摘要',
      sentTo: '发送给 {email} 的邮件',
      uploadedAt: '上传',
      summaryUnavailable: '该视频无法提供摘要',
      basisTranscript: '基于字幕分析的摘要',
      basisDescription: '基于视频说明分析的摘要',
      basisTitle: '仅基于标题的简要摘要',
    },
    breaking: {
      subject: '[快讯] {title}',
      heading: '🚨 快讯已送达',
      channel: '频道',
      publishedAt: '发布时间',
      summary: '摘要',
      keyPoints: '📌 要点',
      watchVideo: '▶ 观看视频',
    },
    error: {
      subject: '[Daily Digest] 系统通知',
      heading: '⚠️ 错误通知',
      message: '发生了以下错误',
      time: '时间',
      action: '需要确认',
    },
    welcome: {
      subject: '🎉 欢迎使用 Daily Digest',
      heading: '欢迎！',
      desc: '每天早上，我们会把你订阅的 YouTube 频道视频总结后发送给你',
      startCta: '去添加频道',
    },
    channels: {
      email: '邮件',
      telegram: 'Telegram',
      kakao: 'KakaoTalk',
      whatsapp: 'WhatsApp',
      line: 'LINE',
    },
  },
  ja: {
    digest: {
      subject: '[Daily Digest] {date} 今日のYouTubeまとめ',
      greeting: 'こんにちは！',
      summary: '今日は{count}本の動画を要約しました',
      openApp: 'ダイジェストを開く',
      breaking: '🚨 速報',
      keyPoints: '📌 要点',
      timeline: '⏱ 主なタイムライン',
      watchVideo: '▶ 動画を見る',
      tagline: '昨日のYouTubeをひと目で',
      manageLink: '通知設定',
      unsubscribe: '配信停止',
      noVideos: '今日は新しい動画がありません',
      emptySubject: '[Daily Digest] {date} — 昨日は新しい動画がありませんでした',
      emptyBody: '購読中のチャンネルに昨日アップされた新しい動画はありませんでした。明日またまとめてお届けします！',
      footer: 'Daily Digest · YouTube要約の自動配信',
      sentTo: '{email} 宛てに送信されたメールです',
      uploadedAt: 'アップロード',
      summaryUnavailable: '要約を提供できない動画です',
      basisTranscript: '字幕をもとに分析した要約です',
      basisDescription: '動画の説明をもとに分析した要約です',
      basisTitle: 'タイトルをもとにした簡単な要約です',
    },
    breaking: {
      subject: '[速報] {title}',
      heading: '🚨 速報が届きました',
      channel: 'チャンネル',
      publishedAt: '公開時刻',
      summary: '要約',
      keyPoints: '📌 要点',
      watchVideo: '▶ 動画を見る',
    },
    error: {
      subject: '[Daily Digest] システム通知',
      heading: '⚠️ エラー通知',
      message: '次のエラーが発生しました',
      time: '時刻',
      action: '確認が必要',
    },
    welcome: {
      subject: '🎉 Daily Digestへようこそ',
      heading: 'ようこそ！',
      desc: '毎朝、購読中のYouTubeチャンネルの動画を要約してお届けします',
      startCta: 'チャンネルを追加する',
    },
    channels: {
      email: 'メール',
      telegram: 'Telegram',
      kakao: 'KakaoTalk',
      whatsapp: 'WhatsApp',
      line: 'LINE',
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
