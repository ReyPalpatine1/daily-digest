// 확인창 안의 회색 안내 목록 박스.
// 모양은 TrialPopup 손실 목록 박스(variant === 'ended')와 같다.
// 줄 앞 '· '는 여기서 붙인다 — i18n 문자열에는 넣지 않는다.
// 바깥 여백은 받지 않는다 — 쓰는 쪽에서 감싸서 준다.
export default function NoticeList({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null

  return (
    <div style={{
      textAlign: 'left', background: 'var(--bg-subtle)',
      border: '0.5px solid var(--border)', borderRadius: 8,
      padding: '12px 14px',
    }}>
      {lines.map((line, i) => (
        // 두 줄로 넘어가면 둘째 줄이 '·' 뒤 글자에 맞춰 시작하도록 내어쓰기한다.
        <div key={i} style={{
          fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.9,
          paddingLeft: '0.8em', textIndent: '-0.8em',
        }}>
          {`· ${line}`}
        </div>
      ))}
    </div>
  )
}
