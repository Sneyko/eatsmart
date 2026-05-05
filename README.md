# EatSmart Ticket Bot

Bot Discord **ticket system + welcome** en Node.js, conçu pour remplacer
**Ticket Tool (free + premium)** avec un coût d'hébergement de **0 €/mois**.

---

## 1. Présentation

Bot tout-en-un, autonome (un seul process Node, persistance SQLite) :

**Tickets — niveau Ticket Tool Premium :**
- Panels multiples avec embeds custom et 1 à 5 boutons par panel
- Catégories de tickets dédiées par bouton (Support, Bug, Partenariat, etc.)
- Modal de questions optionnel (1 à 5 questions, réponses postées en embed)
- Multi-embeds dans le message d'ouverture, sans limite de 250 caractères
- Support team roles auto-ajoutés au channel à l'ouverture
- Ping configurable (rôle staff, owner, ou personne)
- Boutons in-ticket : `Close`, `Close with reason`, `Claim`, `Reopen`, `Delete`
- **Two-step close** : confirmation avant suppression
- **Claim system** : un staff revendique le ticket, les autres staff perdent l'écriture
- **Renaming auto** : `closed-{number}` à la fermeture
- Add/Remove role auto au créateur (à l'ouverture / à la fermeture)
- Thread privé staff optionnel à l'ouverture
- Limite de tickets simultanés par user (configurable)
- Blacklist `/blacklist add @user reason`
- **Auto-close inactivity** (cron interne 30 min, pas de cron externe)
- **Transcripts HTML** postés dans un channel dédié + DM au créateur
- **Feedback / rating 1-5** étoiles via DM, commentaire optionnel, stocké en DB
- Logs d'actions staff (open / claim / close / delete) dans un channel dédié

**Welcome :**
- Channel + embed configurables (titre, description, couleur, image, thumbnail)
- Variables : `{user}`, `{server}`, `{membercount}`
- Auto-rôle au nouveau membre
- Toggle on/off

**Commandes (slash) :**
- `/setup tickets`, `/setup welcome`
- `/panel create`, `/panel addbutton`, `/panel send`, `/panel list`, `/panel delete`
- `/ticket close|claim|add|remove|rename|transfer|owner`
- `/blacklist add|remove|list`
- `/stats`

---

## 2. Prérequis

- **Node.js 20 LTS** (`node -v` doit afficher `v20.x`)
- Un compte Discord développeur (gratuit)

---

## 3. Création de l'application Discord

1. Va sur [discord.com/developers/applications](https://discord.com/developers/applications) et clique **New Application**.
2. Donne un nom, accepte les TOS, **Create**.
3. Onglet **Bot** → clique **Reset Token** → copie-le, c'est ton `DISCORD_TOKEN`. Garde-le secret.
4. Onglet **Bot** → **Privileged Gateway Intents**, active les **3** suivants :
   - **Server Members Intent** (welcome)
   - **Message Content Intent** (transcripts, autoclose)
   - **Presence Intent** (pas obligatoire mais coche-le, ça évite les surprises)
5. Onglet **General Information** → copie l'**Application ID** (= `CLIENT_ID`).
6. Onglet **OAuth2 → URL Generator** :
   - **Scopes** : `bot`, `applications.commands`
   - **Bot Permissions** :
     - View Channels
     - Manage Channels
     - Manage Roles
     - Send Messages
     - Embed Links
     - Attach Files
     - Read Message History
     - Manage Messages
     - Use External Emojis
     - Create Private Threads
     - Send Messages in Threads
   - Copie l'URL générée, ouvre-la dans un navigateur, sélectionne ton serveur, **Authorize**.
7. Place le rôle créé pour le bot **AU-DESSUS** des rôles staff dans `Paramètres serveur → Rôles`, sinon il ne pourra pas gérer les permissions.

---

## 4. Installation locale

```bash
git clone https://github.com/sneyko/eatsmart.git
cd eatsmart
npm install
cp .env.example .env
# Édite .env et colle DISCORD_TOKEN, CLIENT_ID, et GUILD_ID (ID de ton serveur de test)
npm run deploy-commands
npm start
```

> **Astuce dev** : tant que `GUILD_ID` est défini, les commandes sont déployées
> **uniquement** sur ce serveur, et **immédiatement**. Sans `GUILD_ID`, le déploiement
> est global et peut prendre jusqu'à 1 heure pour apparaître.

---

## 5. Hébergement gratuit — Option A : Oracle Cloud Free Tier (recommandé)

Oracle offre **toujours** (Always Free) une VM ARM Ampere A1 jusqu'à 4 cœurs / 24 GB RAM, totalement suffisant.

### a. Créer le compte

1. [signup.cloud.oracle.com](https://signup.cloud.oracle.com) — choisis ta région (la plus proche, ex. **Frankfurt** ou **Paris**).
2. Une **carte bancaire est demandée** pour vérification d'identité, mais **rien n'est débité** tant que tu restes sur le palier Always Free.
3. Vérifie ton numéro de téléphone, attends la création du tenant (~5 min).

### b. Créer la VM ARM

1. Console Oracle → **Compute → Instances → Create Instance**.
2. **Image** : `Canonical Ubuntu 22.04`.
3. **Shape** : clique `Change shape` → **Ampere → VM.Standard.A1.Flex** → 1 OCPU, 6 GB RAM (suffit largement).
4. **Add SSH keys** : génère localement avec `ssh-keygen -t ed25519`, colle le `.pub`.
5. **Create**. Note l'IP publique.

### c. Connexion + install Node 20

```bash
ssh ubuntu@<IP-PUBLIQUE>
sudo apt update && sudo apt install -y build-essential git curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
nvm install 20
nvm alias default 20
node -v   # v20.x
```

Ouvre le port sortant 443 (Oracle bloque par défaut beaucoup de choses, mais le sortant HTTPS est ouvert). Aucun port entrant n'est requis pour ce bot.

### d. Cloner et lancer

```bash
git clone https://github.com/sneyko/eatsmart.git
cd eatsmart
npm install
cp .env.example .env
nano .env   # remplis DISCORD_TOKEN, CLIENT_ID, GUILD_ID
npm run deploy-commands
```

### e. Lancer en service systemd (auto-restart au reboot)

Crée `/etc/systemd/system/eatsmart-bot.service` :

```ini
[Unit]
Description=EatSmart Ticket Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/eatsmart
EnvironmentFile=/home/ubuntu/eatsmart/.env
ExecStart=/home/ubuntu/.nvm/versions/node/v20.18.0/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=append:/home/ubuntu/eatsmart/bot.log
StandardError=append:/home/ubuntu/eatsmart/bot.log

[Install]
WantedBy=multi-user.target
```

> Adapte le chemin `ExecStart` au résultat de `which node`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable eatsmart-bot
sudo systemctl start eatsmart-bot
sudo systemctl status eatsmart-bot
sudo reboot          # vérifie qu'il redémarre seul
sudo systemctl status eatsmart-bot
```

---

## 6. Hébergement gratuit — Option B : Fly.io

Le free tier Fly.io n'existe plus officiellement, mais on tient en dessous de **5 $/mois** (souvent 0 $ avec le crédit `pay-as-you-go`). Volume persistant requis pour `data.db`.

`Dockerfile` :

```Dockerfile
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++ sqlite-dev
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV DB_PATH=/data/data.db
CMD ["node", "src/index.js"]
```

`fly.toml` :

```toml
app = "eatsmart-bot"
primary_region = "cdg"

[build]

[env]
  NODE_ENV = "production"
  DB_PATH = "/data/data.db"
  LOG_LEVEL = "info"

[[mounts]]
  source = "data"
  destination = "/data"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

```bash
flyctl auth login
flyctl launch --no-deploy        # accepte le nom, refuse la DB Postgres
flyctl volumes create data --size 1 --region cdg
flyctl secrets set DISCORD_TOKEN=xxx CLIENT_ID=xxx
flyctl deploy
flyctl logs
```

---

## 7. Configuration in-Discord (exemple complet)

1. `/setup tickets category:#tickets log_channel:#staff-log transcript_channel:#transcripts support_role:@Staff max_open_per_user:1 autoclose_hours:48`
2. `/panel create` → modal : titre `Ouvrir un ticket`, description `Choisis une catégorie ci-dessous`, couleur `#5865F2`. Récupère le **panel_id** (ex : `1`).
3. `/panel addbutton panel_id:1 label:Support emoji:🛟`
4. `/panel addbutton panel_id:1 label:Bug emoji:🐛 with_questions:true` → modal des questions (laisse les cases vides pour ignorer).
5. `/panel addbutton panel_id:1 label:Partenariat emoji:🤝 ping_role:@Owner`
6. `/panel send panel_id:1 channel:#open-ticket`
7. `/setup welcome enabled:true channel:#welcome title:"Bienvenue {user} !" description:"Tu es notre {membercount}ᵉ membre sur **{server}** !" color:#57F287 autorole:@Member`

---

## 8. Sauvegarde

`data.db` est le seul fichier critique. Il est en mode WAL — sauvegarde-le pendant que le bot tourne en utilisant l'API SQLite (`.backup`), pas un simple `cp` :

```bash
# Backup manuel
sqlite3 /home/ubuntu/eatsmart/data.db ".backup '/home/ubuntu/backup-$(date +%F).db'"
```

Cron quotidien + sync vers stockage gratuit (rclone vers Google Drive / Dropbox) :

```bash
crontab -e
# tous les jours à 3h
0 3 * * * sqlite3 /home/ubuntu/eatsmart/data.db ".backup '/home/ubuntu/backups/data-$(date +\%F).db'" && rclone copy /home/ubuntu/backups gdrive:eatsmart-backups
```

Alternative simple : commit chiffré périodique vers un repo privé GitHub (`age` ou `gpg` pour chiffrer le `.db`).

---

## 9. Troubleshooting

- **Les commandes n'apparaissent pas dans Discord**
  - As-tu lancé `npm run deploy-commands` ?
  - Si `GUILD_ID` est vide → déploiement global, ça peut prendre 1h. Mets `GUILD_ID` pour un déploiement instantané.
  - Reset Discord (`Ctrl+R`) après le déploiement.
- **Le bot ne crée pas le channel**
  - Le rôle du bot doit être **au-dessus** des rôles staff dans la liste des rôles.
  - Vérifie qu'il a `Manage Channels` et `Manage Roles`.
  - Vérifie que la catégorie de tickets est bien sélectionnée dans `/setup tickets`.
- **Transcripts vides**
  - Active **Message Content Intent** dans le portail Discord (étape 3.4).
  - Les messages effacés avant la fermeture ne sont jamais transcrits, c'est normal.
- **Welcome ne s'envoie pas**
  - **Server Members Intent** doit être activé dans le portail.
  - `/setup welcome enabled:true` → sans `enabled`, rien ne s'envoie.
- **`better-sqlite3` ne compile pas**
  - Sur Alpine : `apk add python3 make g++ sqlite-dev`
  - Sur Ubuntu : `apt install build-essential`

---

## 10. Roadmap V2

- Dashboard web (Next.js) pour configurer panels & welcome sans slash commands
- Multi-langue (i18n FR/EN/ES)
- Intégration Google Drive pour stocker les transcripts hors disque
- Analytics avancées (SLA, heatmaps, satisfaction)
- Macros / réponses pré-enregistrées
- Auto-tagging IA des tickets

---

## License

MIT
