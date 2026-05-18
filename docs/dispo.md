# Disponibilites cuistot

Cette fonctionnalite permet a un cuistot d'afficher sa disponibilite dans un salon dedie.

## Configuration

Configurer le salon des disponibilites, le role autorise et la destination du bouton :

```text
/setup dispo channel:#dispos role:@Cuistot order_channel:#commande
```

Ou, pour pointer le bouton vers un message Discord precis :

```text
/setup dispo channel:#dispos role:@Cuistot order_link:https://discord.com/channels/SERVER_ID/CHANNEL_ID/MESSAGE_ID
```

`order_channel` et `order_link` sont exclusifs. Si l'un est configure, il remplace l'autre.

## Utilisation cuistot

Afficher sa disponibilite :

```text
/dispo on message:Je suis disponible pendant 1h
```

Retirer sa disponibilite :

```text
/dispo off
```

Un cuistot ne peut avoir qu'un seul embed actif. Relancer `/dispo on` supprime l'ancien embed et publie le nouveau. `/dispo off` supprime l'embed actif pour ne laisser que les cuistots disponibles dans le salon.
