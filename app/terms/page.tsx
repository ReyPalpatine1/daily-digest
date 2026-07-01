'use client'

import LegalPage from '@/components/LegalPage'
import { TERMS_KO } from '@/lib/legal/content'

export default function TermsPage() {
  return <LegalPage title="이용약관" content={TERMS_KO} />
}
