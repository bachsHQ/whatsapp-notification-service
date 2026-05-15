import dotenv from 'dotenv';

dotenv.config();

export const config = {
  apiKey: process.env.API_KEY || '',
  serviceName: process.env.SERVICE_NAME || 'WhatsApp Notification Service',
  logLevel: process.env.LOG_LEVEL || 'info',
  port: parseInt(process.env.PORT || '3000', 10),
  proxyUrl: process.env.PROXY_URL || '',
  openaiApiKey: process.env.OPENAI_API_KEY || ''
};

if (!config.apiKey) {
  console.warn('WARNING: API_KEY is not set. All /notify requests will be rejected.');
}

export default config;
