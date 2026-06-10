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

function isSocialCrawler(req) {
  const userAgent = String(req.headers['user-agent'] || '');
  return /\b(Discordbot|Twitterbot|facebookexternalhit|Facebot|Slackbot|LinkedInBot|WhatsApp|TelegramBot|SkypeUriPreview|Pinterest|redditbot|Applebot)\b/i.test(
    userAgent,
  );
}

function renderInvitePreviewPage(inviteUrl) {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0; url=${inviteUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://www.eatsmart.tech/invite" />
    <meta property="og:title" content="Rejoins le serveur Discord EatSmart" />
    <meta property="og:description" content="Commande et suis tes demandes directement dans le Discord EatSmart." />
    <meta property="og:image" content="https://www.eatsmart.tech/site/assets/banner.gif" />
    <meta property="og:image:width" content="800" />
    <meta property="og:image:height" content="450" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Rejoins le serveur Discord EatSmart" />
    <meta name="twitter:description" content="Commande et suis tes demandes directement dans le Discord EatSmart." />
    <meta name="twitter:image" content="https://www.eatsmart.tech/site/assets/banner.gif" />
    <title>Rejoins EatSmart</title>
    <link rel="stylesheet" href="/site/styles.css" />
  </head>
  <body class="error-page">
    <main class="error-shell">
      <a class="brand" href="/" aria-label="Accueil EatSmart">
        <span class="brand-mark">ES</span>
        <span>EatSmart</span>
      </a>
      <section class="error-card">
        <p class="eyebrow">Discord EatSmart</p>
        <h1>Rejoins le serveur EatSmart.</h1>
        <p>Tu vas être redirigé vers Discord.</p>
        <a class="button button-primary" href="${inviteUrl}">Ouvrir Discord</a>
      </section>
    </main>
  </body>
</html>`;
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

  if (isSocialCrawler(req)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderInvitePreviewPage(inviteUrl));
    return;
  }

  res.writeHead(302, { Location: inviteUrl });
  res.end();
}
