import mongoose from 'mongoose';
import { config, devMode } from './config.js';
import { createApp } from './app.js';
import { recoverPendingAlerts } from './services/alert.js';

async function main() {
  await mongoose.connect(config.mongoUri);
  const recovered = await recoverPendingAlerts();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`NIJAAT AI API listening on port ${config.port} (${config.env})`);
    if (recovered) console.log(`Recovered ${recovered} pending alert(s) after restart`);
    if (devMode.sms) console.log('SMS: development mode. Messages are logged, not sent. Set TWILIO_* to send.');
    if (devMode.mail) console.log('Email: development mode. Messages are logged, not sent. Set SMTP_* to send.');
    if (!config.gemini.key) console.log('Report summarisation: GEMINI_API_KEY is not set.');
    if (!config.googleMapsKey) console.log('Hospital search: using OpenStreetMap. Set GOOGLE_MAPS_SERVER_KEY for Google data and live traffic.');
  });
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
