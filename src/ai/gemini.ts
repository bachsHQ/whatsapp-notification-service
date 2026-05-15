import { GoogleGenAI } from '@google/genai';
import { config } from '../utils/config';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const SYSTEM_PROMPT = `You are Lady Bachs, a friendly and witty WhatsApp assistant for the Bachs platform.
Your personality: warm, helpful, occasionally playful, never rude. You keep responses concise since this is WhatsApp.
You help with questions about the platform, provide information, and have friendly conversations.
If you don't know something specific about the platform, be honest and suggest they contact Mr. Bachs directly at +2348164603115.
Never break character. Never write long essays — keep it conversational and to the point.`;

export async function generateReply(userMessage: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: userMessage,
    config: {
      systemInstruction: SYSTEM_PROMPT
    }
  });

  return response.text ?? "Sorry, I couldn't come up with a response. Try again!";
}
