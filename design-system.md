# Daily Digest 디자인 시스템

미니멀 SaaS 스타일 — 흰색/회색 베이스 + 검정 강조.
모든 색상은 CSS 변수로 정의되어 있으며 `[data-theme]` 속성으로 라이트/다크 모드를 전환한다.

> 정의 위치: [app/globals.css](app/globals.css)
> 폰트 로드: [app/layout.tsx](app/layout.tsx)

---

## 1. 색상

### 1-1. 라이트 모드 (기본)

| 변수 | 값 | 용도 |
|------|----|----|
| `--bg-primary` | `#FAFAFA` | 전체 페이지 배경 |
| `--bg-card` | `#FFFFFF` | 카드, 모달, 사이드바 배경 |
| `--bg-subtle` | `#F4F4F5` | 부드러운 강조 배경 (hover, 인풋) |
| `--border` | `#E5E5E5` | 일반 테두리, 구분선 |
| `--border-light` | `#F4F4F5` | 얇은 보조 구분선 |
| `--text-primary` | `#0A0A0A` | 본문, 제목 |
| `--text-secondary` | `#525252` | 보조 텍스트, 라벨 |
| `--text-tertiary` | `#71717A` | 회색 메타 텍스트 |
| `--text-muted` | `#A1A1AA` | 가장 흐린 보조 텍스트, placeholder |
| `--accent` | `#0A0A0A` | 주요 버튼, 강조 컬러 |
| `--danger` | `#DC2626` | 속보, 삭제, 에러 |
| `--warning` | `#F59E0B` | 경고, 주의 |
| `--success` | `#10B981` | 성공, 완료 |

### 1-2. 다크 모드 (`<html data-theme="dark">`)

| 변수 | 값 |
|------|----|
| `--bg-primary` | `#0A0A0A` |
| `--bg-card` | `#131313` |
| `--bg-subtle` | `#1F1F1F` |
| `--border` | `#1F1F1F` |
| `--border-light` | `#1F1F1F` |
| `--text-primary` | `#FAFAFA` |
| `--text-secondary` | `#A1A1AA` |
| `--text-tertiary` | `#71717A` |
| `--text-muted` | `#525252` |
| `--accent` | `#FFFFFF` |
| `--danger` | `#F87171` |
| `--warning` | `#FBBF24` |
| `--success` | `#34D399` |

### 1-3. 사용 가이드

- 색상을 직접 헥스값으로 쓰지 말 것. **반드시 변수**로 참조한다.
  ```tsx
  // BAD
  <div style={{ background: "#FFFFFF", color: "#0A0A0A" }} />
  // GOOD
  <div style={{ background: "var(--bg-card)", color: "var(--text-primary)" }} />
  ```
- 텍스트 위계: 제목 = `--text-primary`, 본문 = `--text-secondary`, 보조 = `--text-tertiary`, placeholder = `--text-muted`.
- 카드 = `--bg-card` + `1px solid var(--border)`. 그림자는 거의 쓰지 않는다.
- 버튼 strong은 `--accent` 배경 + 카드 배경 텍스트. 다크모드에선 자동으로 반전된다.

---

## 2. 폰트

| 종류 | 폰트 | 변수 |
|------|------|------|
| 영문/숫자 | **Inter** (Google Fonts, `next/font`) | `--font-inter` |
| 한글 | **Pretendard Variable** (CDN @import) | `Pretendard Variable`, `Pretendard` |
| 모노스페이스 | **JetBrains Mono** (Google Fonts, `next/font`) | `--font-jetbrains-mono` |

기본 스택은 `--font-sans` / `--font-mono` 두 변수로 추상화돼 있다.

```css
font-family: var(--font-sans);  /* 본문 (Inter → Pretendard → system) */
font-family: var(--font-mono);  /* 코드, 숫자 강조 */
```

### 2-1. 타이포 스케일

| 용도 | 크기 | 굵기 | line-height |
|------|------|------|------------|
| Display | 32–40px | 700 | 1.2 |
| H1 | 24–28px | 700 | 1.3 |
| H2 | 20px | 600 | 1.35 |
| H3 | 16–18px | 600 | 1.4 |
| Body | 14–15px | 400–500 | 1.55 |
| Small | 13px | 400 | 1.45 |
| Caption | 12px | 500 | 1.4 |

---

## 3. 간격 (Spacing)

4의 배수를 기본 단위로 사용한다.

| 토큰 | px | 용도 |
|------|----|------|
| `2xs` | 4 | 아이콘-텍스트 간격 |
| `xs` | 8 | 칩 내부 패딩, 작은 갭 |
| `sm` | 12 | 인풋 내부 패딩 |
| `md` | 16 | 카드 내부 패딩, 기본 갭 |
| `lg` | 24 | 섹션 사이 간격 |
| `xl` | 32 | 페이지 패딩 |
| `2xl` | 48 | 큰 섹션 구분 |
| `3xl` | 64 | 페이지 최상단/최하단 여백 |

---

## 4. 라운드 (border-radius)

| 변수 | 값 | 용도 |
|------|----|------|
| `--radius-sm` | 6px | 칩, 작은 버튼 |
| `--radius-md` | 8px | 인풋, 일반 버튼 |
| `--radius-lg` | 12px | 카드 |
| `--radius-xl` | 16px | 큰 카드, 모달 |
| `--radius-full` | 9999px | 원형 버튼, 아바타, pill |

---

## 5. 그림자

미니멀 디자인이므로 그림자는 절제해서 사용한다. 기본은 테두리 사용을 우선시한다.

| 변수 | 용도 |
|------|------|
| `--shadow-sm` | 떠 있는 작은 요소 (드롭다운 트리거 등) |
| `--shadow-md` | 드롭다운, 팝오버 |
| `--shadow-lg` | 모달, 다이얼로그 |

---

## 6. 컴포넌트 표준

### 6-1. 버튼

**Primary (검정 버튼)**
```tsx
<button
  style={{
    background: "var(--accent)",
    color: "var(--bg-card)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "var(--font-sans)",
  }}
>
  저장하기
</button>
```

**Secondary (테두리 버튼)**
```tsx
<button
  style={{
    background: "var(--bg-card)",
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 500,
  }}
>
  취소
</button>
```

**Ghost (배경 없음)**
```tsx
<button
  style={{
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "8px 12px",
    fontSize: 14,
  }}
>
  더보기
</button>
```

상태:
- hover: 배경 한 단계 진하게 (`--bg-subtle`) 또는 opacity 0.9
- disabled: opacity 0.4, cursor not-allowed
- focus: `outline: 2px solid var(--accent); outline-offset: 2px;`

### 6-2. 카드

```tsx
<div
  style={{
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: 20,
  }}
/>
```

### 6-3. 입력창

```tsx
<input
  style={{
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "10px 12px",
    fontSize: 15,
    color: "var(--text-primary)",
    width: "100%",
  }}
/>
```

placeholder 색: `var(--text-muted)`.
focus: `border-color: var(--accent); outline: none;`.

### 6-4. 칩 / 뱃지

```tsx
<span
  style={{
    background: "var(--bg-subtle)",
    color: "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 500,
    padding: "4px 8px",
    borderRadius: "var(--radius-sm)",
  }}
>
  태그
</span>
```

상태 뱃지: 배경은 해당 색 + 10% 알파, 텍스트는 해당 색 풀톤.

---

## 7. 모션

- 기본 transition: `200ms ease` (색, 배경, 테두리)
- hover/press: `transform: scale(0.98)` 또는 배경 변화
- 페이지 전환은 별도 라이브러리 없이 fade-in 200ms

---

## 8. 다크 모드 전환

```ts
document.documentElement.dataset.theme = "dark"; // 또는 "light"
```

`html[data-theme="dark"]` 셀렉터가 자동으로 변수 값을 교체한다. 컴포넌트 코드는 변수만 참조하면 되며, 별도 분기 로직이 필요 없다.

---

## 9. 마이그레이션 체크리스트 (다음 단계에서 사용)

- [ ] 모든 인라인 `#0a0a0a`, `#111`, `#222` 등을 변수로 교체
- [ ] 카드/사이드바/탑바 배경을 `--bg-card` 로 통일
- [ ] 본문 텍스트 색을 `--text-primary` / `--text-secondary` 로 분리
- [ ] 강조 버튼을 `--accent` 기반으로 통일
- [ ] 폰트는 `var(--font-sans)` / `var(--font-mono)` 만 사용
- [ ] 라운드는 `--radius-*` 토큰으로 정렬
