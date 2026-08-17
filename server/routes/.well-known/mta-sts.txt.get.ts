// GET /.well-known/mta-sts.txt — the MTA-STS policy.
//
// Without it, a sending server can be talked out of TLS: an attacker in the path
// strips the STARTTLS offer and the mail arrives in plaintext, which for our
// traffic means sign-in codes and payment notices. This tells senders to require
// TLS and refuse to deliver without it.
//
// 'testing' rather than 'enforce' to begin with: a wrong host list in enforce
// mode means mail to us is refused outright rather than delivered insecurely.
// Reports come back, the list gets confirmed, and then it moves to enforce.
export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
  setHeader(event, 'Cache-Control', 'public, max-age=3600');
  return [
    'version: STSv1',
    'mode: testing',
    'mx: aspmx.l.google.com',
    'mx: alt1.aspmx.l.google.com',
    'mx: alt2.aspmx.l.google.com',
    'mx: alt3.aspmx.l.google.com',
    'mx: alt4.aspmx.l.google.com',
    'max_age: 604800'
  ].join('\n') + '\n';
});
