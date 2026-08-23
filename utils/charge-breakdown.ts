// What made up a charge, in words.
//
// Shared rather than living in one page: the wallet and the admin financial log
// both answer the same question — "what is this figure for" — and two copies of
// the wording drift the moment a new charge type is added.
export function chargeBreakdown(entry: { reason: string; meta?: any } | null | undefined): string {
  if (!entry) return '';
  const m = entry.meta || {};
  const bits: string[] = [];

  switch (entry.reason) {
    case 'voice_minute':
      if (m.seconds) bits.push(`${m.seconds}s`);
      if (m.source === 'inbound') bits.push('incoming');
      else if (m.source === 'dialer') bits.push('outgoing');
      else if (m.source === 'live_call') bits.push('web call');
      if (m.provider) bits.push(String(m.provider));
      break;
    case 'ai_managed':
      if (m.turns) bits.push(`${m.turns} exchange${m.turns === 1 ? '' : 's'}`);
      if (m.sttSeconds) bits.push(`${m.sttSeconds}s heard`);
      if (m.ttsChars) bits.push(`${m.ttsChars} characters spoken`);
      break;
    case 'transcription':
      if (m.seconds) bits.push(`${m.seconds}s of audio`);
      break;
    case 'voice_otp':
      if (m.to) bits.push(String(m.to));
      break;
    case 'number_monthly':
    case 'number_purchase':
      if (m.telnum) bits.push(String(m.telnum));
      if (m.channels) bits.push(`${m.channels} channel${m.channels === 1 ? '' : 's'}`);
      break;
    case 'plan_fee':
      if (m.plan) bits.push(String(m.plan));
      if (m.interval) bits.push(m.interval === 'annual' ? 'yearly' : 'monthly');
      break;
    case 'topup':
      if (m.provider) bits.push(String(m.provider));
      break;
  }
  return bits.join(' · ');
}
