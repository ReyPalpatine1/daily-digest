import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: Request) {
  try {
    // Vercel Cron 보안 헤더 확인
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: '인증 실패' }, { status: 401 })
    }

    // 활성화된 모든 유저 가져오기
    const { data: settings } = await supabase
      .from('settings')
      .select('user_id')
      .eq('active', true)

    if (!settings?.length) {
      return NextResponse.json({ message: '활성 유저 없음' })
    }

    // 각 유저별 다이제스트 실행
    const results = await Promise.allSettled(
      settings.map(s =>
        fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/digest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: s.user_id }),
        })
      )
    )

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    return NextResponse.json({ succeeded, failed })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}