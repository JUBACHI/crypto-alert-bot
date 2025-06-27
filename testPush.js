require('dotenv').config();
const PushBullet = require('pushbullet');
const p = new PushBullet.default(process.env.PUSHBULLET_TOKEN);

p.devices((err, response) => {
  if (err) return console.error("❌ Erreur récupération devices :", err.message);

  const devices = response.devices;
  if (!devices.length) {
    return console.error("❌ Aucun appareil PushBullet trouvé.");
  }

  // Affiche les appareils
  console.log("📱 Appareils disponibles :");
  devices.forEach((device, i) => {
    console.log(`- ${i + 1}. ${device.nickname} (${device.iden})`);
  });

  // Utilise le premier appareil
  const device = devices[0];

  // Envoie une notif directe
  p.note(device.iden, '✅ Test vers appareil', 'Message reçu ? 🎯', (err) => {
    if (err) {
      console.error("❌ Erreur PushBullet :", err.message);
    } else {
      console.log(`✅ Notification envoyée vers ${device.nickname}`);
    }
  });
});
