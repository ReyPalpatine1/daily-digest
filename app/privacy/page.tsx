'use client'

import LegalPage from '@/components/LegalPage'
import { PRIVACY_KO } from '@/lib/legal/content'

export default function PrivacyPage() {
  return <LegalPage title="개인정보처리방침" content={PRIVACY_KO} />
}
