
import { Blob } from '@google/genai';

/**
 * Encodes a Uint8Array into a base64 string.
 * @param bytes The byte array to encode.
 * @returns The base64 encoded string.
 */
export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Creates a Blob object for the Gemini API from raw Float32Array audio data.
 * @param data The Float32Array from the microphone.
 * @returns A Blob object with base64 encoded audio data.
 */
export function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  // Convert Float32 to Int16 PCM
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}
