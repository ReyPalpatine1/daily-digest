'use client'

import LegalPage from '@/components/LegalPage'
import { REFUND_KO } from '@/lib/legal/content'

export default function RefundPage() {
  return <LegalPage title="환불 정책" content={REFUND_KO} />
}
