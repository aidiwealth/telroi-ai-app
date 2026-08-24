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
      // The carrier is deliberately not named. Which network carried a call is
      // our arrangement, not the client's, and putting Twilio or Telnyx on
      // somebody's statement tells them nothing they can act on while telling
      // them who we buy from.
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
      // Card or transfer, not which processor. A client knows how they paid;
      // naming Monnify or Paystack is our plumbing.
      if (m.provider === 'monnify') bits.push('bank transfer');
      else if (m.provider) bits.push('card');
      break;
  }
  return bits.join(' · ');
}
