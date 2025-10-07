
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveSession, Modality, LiveServerMessage, Blob } from '@google/genai';
import { encode, createBlob } from './utils/audio';

const SYSTEM_INSTRUCTION = "You are an expert transcription service. Your only task is to accurately transcribe the user's speech. The user will speak in a mix of English and Arabic. Transcribe English in the English alphabet and Arabic in the Arabic script. Do not translate or add any commentary.";

const App: React.FC = () => {
    const [apiKey, setApiKey] = useState<string>('');
    const [isListening, setIsListening] = useState<boolean>(false);
    const [transcription, setTranscription] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const sessionRef = useRef<LiveSession | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const currentTranscriptionRef = useRef<string>('');

    const stopListening = useCallback(async () => {
        if (!isListening) return;
        setIsListening(false);

        if (sessionRef.current) {
            try {
                sessionRef.current.close();
            } catch (e) {
                console.error("Error closing session:", e);
            }
            sessionRef.current = null;
        }

        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }

        if (mediaStreamSourceRef.current) {
            mediaStreamSourceRef.current.disconnect();
            mediaStreamSourceRef.current = null;
        }
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            try {
                await audioContextRef.current.close();
            } catch (e) {
                console.error("Error closing AudioContext:", e);
            }
            audioContextRef.current = null;
        }
        
        if (currentTranscriptionRef.current) {
            setTranscription(prev => (prev + currentTranscriptionRef.current).trim() + '\n\n');
            currentTranscriptionRef.current = '';
        }

    }, [isListening]);

    const startListening = useCallback(async () => {
        if (isListening || !apiKey) return;
        setIsListening(true);
        setError(null);
        setTranscription('');
        currentTranscriptionRef.current = '';

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            const ai = new GoogleGenAI({ apiKey });
            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        if (!mediaStreamRef.current) return;
                        
                        const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        audioContextRef.current = context;

                        const source = context.createMediaStreamSource(mediaStreamRef.current);
                        mediaStreamSourceRef.current = source;
                        
                        const processor = context.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current = processor;

                        processor.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob: Blob = createBlob(inputData);
                            
                            sessionPromise.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        source.connect(processor);
                        processor.connect(context.destination);
                    },
                    onmessage: (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const text = message.serverContent.inputTranscription.text;
                            currentTranscriptionRef.current += text;
                            setTranscription(prev => prev + text);
                        }

                        if (message.serverContent?.turnComplete) {
                            const fullTurn = currentTranscriptionRef.current;
                            currentTranscriptionRef.current = '';
                            setTranscription(prev => {
                                const base = prev.slice(0, -fullTurn.length);
                                return (base + fullTurn).trim() + ' ';
                            });
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        setError('An error occurred with the transcription service. Please check the console.');
                        stopListening();
                    },
                    onclose: (e: CloseEvent) => {
                        console.log('Session closed');
                        stopListening();
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    systemInstruction: SYSTEM_INSTRUCTION,
                },
            });
            
            sessionRef.current = await sessionPromise;

        } catch (err) {
            console.error('Failed to start listening:', err);
            setError('Could not access the microphone. Please grant permission and try again.');
            setIsListening(false);
        }

    }, [isListening, apiKey, stopListening]);

    const handleToggleListening = () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    };
    
    useEffect(() => {
        return () => {
            stopListening();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isButtonDisabled = !apiKey && !isListening;
    let buttonText = 'Enter API Key to Start';
    if (apiKey) {
        buttonText = isListening ? 'Stop Listening' : 'Start Listening';
    }

    return (
        <div className="flex flex-col items-center justify-start min-h-screen bg-gray-900 text-gray-100 p-4 sm:p-6 md:p-8 font-sans">
            <div className="w-full max-w-4xl mx-auto flex flex-col h-full">
                <header className="text-center mb-6">
                    <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-400">
                        Gemini Live Transcriber
                    </h1>
                </header>
                
                <div className="mb-6 w-full max-w-lg mx-auto">
                    <label htmlFor="apiKey" className="block text-sm font-medium text-gray-400 mb-2">
                        Enter your Gemini API Key
                    </label>
                    <input
                        id="apiKey"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Paste your API key here"
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-md shadow-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-gray-200 transition"
                        disabled={isListening}
                    />
                </div>

                <main className="flex-grow flex flex-col bg-gray-800/50 rounded-lg shadow-2xl border border-gray-700 overflow-hidden">
                    <div className="flex-grow p-4 sm:p-6 overflow-y-auto">
                        <textarea
                            readOnly
                            value={transcription}
                            placeholder="Transcription will appear here..."
                            className="w-full h-full min-h-[300px] bg-transparent text-gray-200 text-lg resize-none focus:outline-none placeholder-gray-500"
                        />
                    </div>
                </main>

                {error && <div className="text-red-400 mt-4 text-center">{error}</div>}

                <footer className="mt-8 text-center">
                    <button
                        onClick={handleToggleListening}
                        disabled={isButtonDisabled}
                        className={`px-8 py-4 text-lg font-semibold rounded-full shadow-lg transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-opacity-50
                            ${isListening 
                                ? 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500' 
                                : 'bg-teal-500 hover:bg-teal-600 text-white focus:ring-teal-400'
                            }
                            ${isButtonDisabled ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                    >
                        {buttonText}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default App;
