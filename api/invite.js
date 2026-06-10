function getInviteUrl() {
  const inviteUrl = String(process.env.DISCORD_INVITE_URL || '').trim();
  if (!inviteUrl) return null;

  try {
    const parsedUrl = new URL(inviteUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
    return parsedUrl.href;
  } catch {
    return null;
  }
}

function renderMissingInvitePage() {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Invitation indisponible - EatSmart</title>
    <link rel="stylesheet" href="/site/styles.css" />
  </head>
  <body class="error-page">
    <main class="error-shell">
      <a class="brand" href="/" aria-label="Accueil EatSmart">
        <span class="brand-mark">ES</span>
        <span>EatSmart</span>
      </a>
      <section class="error-card" aria-labelledby="error-title">
        <p class="eyebrow">Invitation indisponible</p>
        <h1 id="error-title">Le lien Discord n'est pas encore configuré.</h1>
        <p>
          La variable d'environnement <strong>DISCORD_INVITE_URL</strong> doit être définie pour activer la
          redirection automatique.
        </p>
        <a class="button button-primary" href="/">Retour accueil</a>
      </section>
    </main>
  </body>
</html>`;
}

export default function handler(req, res) {
  const inviteUrl = getInviteUrl();
  if (!inviteUrl) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderMissingInvitePage());
    return;
  }

  res.writeHead(302, { Location: inviteUrl });
  res.end();
}
