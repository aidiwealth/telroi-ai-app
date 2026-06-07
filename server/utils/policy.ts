// server/utils/policy.ts
// Telroi's Terms of Service, Privacy Policy and Data Protection Policy as a
// single versioned source of truth. Adapted for Telroi's voice-infrastructure
// business. Bump POLICY_VERSION whenever the text changes — the version a user
// accepted is recorded against their workspace.

export const POLICY_VERSION = '2026-05-29';
export const POLICY_TITLE = 'Telroi Terms of Service, Privacy & Data Protection Policy';

// Plain-text sections (used for the in-app reader and the emailed copy).
export const POLICY_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: 'Terms of Service',
    body: [
      'These Terms of Service form a contract between you and Telroi.Ai ("Telroi", "us", "we" or "our"), the provider of the Telroi website and the voice-infrastructure services accessible from it (collectively, the "Telroi Service"). By creating an account you agree to be bound by these Terms. If you do not agree, please do not use the Telroi Service. "You" refers both to you as an individual and to the entity you represent.'
    ]
  },
  {
    heading: '1. Your Account',
    body: [
      '1.1 Eligibility. Your account must be registered by a human; accounts created by automated methods are not permitted. You must be 18 years of age or older.',
      '1.2 Registration Information. You must provide a valid, permanent email address and any other information Telroi requires during registration.',
      '1.3 Security. You are responsible for maintaining the security of your account and credentials. Telroi is not liable for any loss arising from your failure to meet this obligation.',
      '1.4 Acceptable Use. You agree to use the Telroi Service only for lawful purposes and in compliance with all applicable laws and telecommunications regulations. You will not distribute malicious code, circumvent security or usage limits, infringe the rights of others, transmit unlawful, fraudulent, deceptive, abusive or harassing content, or misrepresent your identity or the origin of any communication.'
    ]
  },
  {
    heading: '2. Payment, Wallet, Upgrades and Downgrades',
    body: [
      '2.1 The Telroi Service operates on a prepaid wallet plus subscription plans billed in advance per our pricing schedule. A valid payment method is required for paid plans; trial accounts are not required to provide one up front.',
      '2.2 There are no refunds or credits for partial months, unused service, or annual prepayments; unused plan credits roll over to the following month. Wallet balances represent prepaid value for usage (airtime, numbers, channels).',
      '2.3 Telroi does not guarantee delivery or connection of calls where failure is caused by the destination carrier, an unreachable or barred number, or factors outside Telroi’s control.',
      '2.4 Refunds of wallet balances are made only where a charge resulted from a fault of Telroi.',
      '2.5 All fees are exclusive of taxes, levies or duties, which are your responsibility.'
    ]
  },
  {
    heading: '3. Routing and Regulatory Compliance',
    body: [
      'Voice traffic must be passed only through the carrier route designated for its region. Traffic from businesses not locally registered in a jurisdiction must not be routed through that jurisdiction’s local route. You agree to adhere to this requirement, and you agree that Telroi may pass on to you any fines, costs or liabilities imposed by a carrier or regulator as a result of your breach, including by deducting such amounts from your wallet.'
    ]
  },
  {
    heading: '4. Trials, Suspension and Termination',
    body: [
      '4.1 Trial plans without a payment method may be downgraded to the entry plan after the trial period ends.',
      '4.2 Telroi may suspend or terminate an account that materially breaches these Terms. On termination, access is removed and account content may be deleted. Unused wallet funds will be refunded within seven (7) days of termination, subject to clause 2.',
      '4.3 Telroi may terminate accounts with no activity for sixty (60) consecutive days.'
    ]
  },
  {
    heading: '5. Changes to the Service and Prices',
    body: [
      '5.1 Telroi may modify or discontinue any part of the Service, including billing options and features, and will make reasonable efforts to notify customers of material changes by email.',
      '5.2 Plan prices may change; where a change requires you to move plans, Telroi will provide at least forty-eight (48) hours’ notice by email.',
      '5.3 Telroi is not liable for any modification, price change, suspension or discontinuance of the Service.'
    ]
  },
  {
    heading: '6. Intellectual Property and Your Content',
    body: [
      '6.1 You retain ownership of the content and data you submit or create through the Telroi Service. These Terms grant Telroi only the limited rights needed to provide the Service to you.',
      '6.2 Reporting and usage data generated through your use of the Service remains yours. You agree that Telroi may use anonymized, non-identifying data to operate, secure and improve the Service.',
      '6.3 The Telroi name, logos and the design of the Service are protected and may not be reused without written permission.'
    ]
  },
  {
    heading: '7. Account Access, Indemnity and Disclaimers',
    body: [
      '7.1 Telroi support may access your account to diagnose an issue when you request assistance; you may ask us not to, and we will honor that where possible.',
      '7.2 You agree to indemnify Telroi against claims arising from your use of the Service, your violation of these Terms, or any third party’s use of your account.',
      '7.3 The Service is provided "as is" and "as available" without warranties of any kind. Telroi does not warrant that the Service will be uninterrupted or error-free.',
      '7.4 Except for breaches of confidentiality or intellectual property, Telroi’s aggregate liability will not exceed the amount you paid Telroi in the 180 days before the claim, and Telroi is not liable for indirect or consequential damages.'
    ]
  },
  {
    heading: 'Privacy Policy',
    body: [
      'Telroi collects and uses personal data only as needed to deliver our products, services and websites. Personal data may include your name, address, telephone number, email address, and other data that could identify you. This policy describes what we collect, how and why we use it, and the choices available to you. Questions may be directed to support@telroi.ai.'
    ]
  },
  {
    heading: 'What we collect',
    body: [
      'Information you provide directly when you create an account or buy services (billing details, name, address), request support, or complete forms.',
      'Account-related information such as purchases, renewals, usage and support history.',
      'Usage data collected automatically when you use the Service, including log files, device and browser information, IP address and approximate location, gathered via cookies and similar technologies.'
    ]
  },
  {
    heading: 'How we use information',
    body: [
      'To deliver, operate, secure and improve the Service; to diagnose problems and prevent fraud and abuse; to understand how the Service is used; and to communicate with you about your account and, where permitted, relevant offers.',
      'We may share personal data with trusted third-party providers strictly as needed to provide the Service (for example, payment processors and carriers), under data-processing terms that prohibit any other use. We share data with authorities only where legally required.'
    ]
  },
  {
    heading: 'Your rights and data security',
    body: [
      'You may access, update, port or delete your personal data through your account settings, or by contacting support@telroi.ai, subject to data we must retain for legal or contractual reasons.',
      'We follow generally accepted standards to protect personal data in transit and at rest, including encryption where appropriate, and retain personal data only as long as necessary to provide the Service or meet legal obligations.',
      'Our Services are intended for those aged 18 or older and are not directed at children.'
    ]
  },
  {
    heading: 'Data Protection Policy',
    body: [
      'Telroi is committed to handling the information of customers, partners and other parties with care and confidentiality, in accordance with applicable data protection regulations including the Nigeria Data Protection Regulation (NDPR) and the General Data Protection Regulation (GDPR) where relevant.',
      'We use personal data for lawful purposes only, protect it against unauthorized access, and share it with third parties solely to provide the Service. We restrict and monitor access to sensitive data, train staff on privacy and security, maintain secure networks, and operate clear procedures for reporting any breach.',
      'As a Telroi customer, you are responsible for complying with applicable data protection laws in your use of the Service, including obtaining any necessary consents from the individuals whose data you process through Telroi. You agree to indemnify Telroi against liabilities arising from your breach of data protection laws.',
      'Regardless of where you are located, Telroi applies international-standard data protection. If you are in the EEA/UK, US (including California access and deletion rights), or elsewhere, you may contact support@telroi.ai to exercise your rights.'
    ]
  }
];

// Render the policy as branded HTML for the emailed copy.
export function policyHtml(): string {
  const body = POLICY_SECTIONS.map((s) => {
    const paras = s.body.map((p) => `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#3b3b42;">${p}</p>`).join('');
    return `<h3 style="margin:22px 0 8px;font-size:15px;color:#0A0A0B;">${s.heading}</h3>${paras}`;
  }).join('');
  return body;
}
