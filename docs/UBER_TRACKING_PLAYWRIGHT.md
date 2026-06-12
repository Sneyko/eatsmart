# Suivi Uber Eats avec Playwright

Le suivi Uber Eats utilise maintenant Playwright en priorité pour ouvrir les liens publics dans un vrai Chromium headless. L'ancien lecteur `fetch()` reste disponible en fallback, car certaines pages peuvent encore exposer assez de texte dans le HTML.

## Pourquoi Playwright

Les pages de suivi Uber Eats sont dynamiques. Un simple `fetch()` récupère souvent un HTML incomplet, sans l'heure d'arrivée visible. Playwright lance Chromium, laisse le JavaScript rendre la page, puis lit le texte visible (`body.innerText`).

Ce n'est pas garanti a 100 %. Si Uber demande une connexion, un captcha, ou ne rend pas l'ETA publiquement, le bot ne contourne pas la protection. Il passe alors par l'ETA manuelle.

## Installation Chromium

En local :

```bash
npm install
npm run install-browsers
```

Sur Fly.io, le `Dockerfile` installe Chromium pendant le build avec :

```bash
npx playwright install --with-deps chromium
```

## Variables d'environnement

```env
ORDER_TRACKING_BROWSER_ENABLED=true
ORDER_TRACKING_HEADLESS=true
ORDER_TRACKING_NAVIGATION_TIMEOUT_MS=30000
ORDER_TRACKING_RENDER_WAIT_MS=6000
ORDER_TRACKING_MAX_CONCURRENT_BROWSERS=1
ORDER_TRACKING_MANUAL_FALLBACK_AFTER_FAILS=3
ORDER_TRACKING_SCREENSHOT_ON_FAIL=false
ORDER_TRACKING_SCREENSHOT_DIR=./debug/order-tracking
```

Pour debug en local avec le navigateur visible :

```env
ORDER_TRACKING_HEADLESS=false
LOG_LEVEL=debug
```

## Tester depuis Discord

Commande staff :

```txt
/order-track-debug url:<lien Uber Eats> show_text:true
```

Dans un ticket avec une commande envoyée :

```txt
/order-track-debug ticket:true show_text:true
```

La réponse est toujours éphémère. `show_text:true` limite l'extrait à 1000 caractères.

## Fallback manuel

Après plusieurs échecs de lecture automatique, le bot envoie une seule fois un message dans le ticket :

```txt
Le suivi automatique Uber Eats n'arrive pas à lire l'heure d'arrivée.
Colle une ETA manuelle ou utilise le bouton Modifier ETA.
```

Le staff peut cliquer sur `Modifier ETA` et saisir :

```txt
12 min
```

ou :

```txt
21:42
```

Un code PIN de 4 à 6 chiffres peut aussi être ajouté. Si Playwright échoue ensuite, les rappels continuent avec cette ETA manuelle.

## Limites

- Pas de compte Uber.
- Pas de cookies Uber stockés.
- Pas de proxy.
- Pas de bypass captcha ou login.
- Pas de webhook Uber Direct.
- Les liens doivent rester publiquement lisibles.
- Si Uber change ses textes, le parser peut nécessiter un ajustement.
