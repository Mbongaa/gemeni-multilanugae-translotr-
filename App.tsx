import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveSession, Modality, LiveServerMessage, Blob } from '@google/genai';
import { createBlob } from './utils/audio';

const SYSTEM_INSTRUCTION = `You are a specialized linguistic transcription service focused on creating a fast and accurate transliteration of mixed English and Arabic speech.

**CRITICAL RULES:**
1.  **Do Not Use Arabic Script:** Your primary task is to represent all spoken words using the English (Latin) alphabet only.
2.  **Transliterate Arabic:** When you hear an Arabic word, you MUST transcribe it phonetically using English letters.
3.  **Preserve English:** When you hear an English word, transcribe it normally.
4.  **Accuracy is Paramount:** Do not add commentary or summaries.

**EXAMPLES:**
-   User: "Today we will be talking about tawheed." -> Output: "Today we will be talking about tawheed."
-   User: "السلام عليكم ورحمه الله وبركاته" -> Output: "As-salamu alaykum wa rahmatullahi wa barakatuh."

Now, begin transcribing the live audio feed following these rules precisely.`;

const API_KEY = 'AIzaSyBQyfIVTIqGhY_OS7lnBSLyeR5iEgwKTpc';


const App: React.FC = () => {
    const [isListening, setIsListening] = useState<boolean>(false);
    
    // More robust state management for better UX
    const [finalizedTranscription, setFinalizedTranscription] = useState<string>('');
    const [inProgressTranscription, setInProgressTranscription] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    // Ref to track listening state in callbacks to avoid stale closures
    const isListeningRef = useRef(isListening);
    useEffect(() => {
        isListeningRef.current = isListening;
    }, [isListening]);

    const sessionRef = useRef<LiveSession | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    // Increased silence threshold for better code-switching handling
    const SILENCE_THRESHOLD_MS = 900;

    const stopListening = useCallback(async () => {
        if (!isListeningRef.current) return;
        setIsListening(false);

        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
        
        // Finalize any lingering in-progress text before stopping
        setInProgressTranscription(currentInProgress => {
            if (currentInProgress.trim()) {
                setFinalizedTranscription(currentFinalized => (currentFinalized + currentInProgress.trim() + ' ').replace(/\s\s+/g, ' '));
            }
            return '';
        });

        if (sessionRef.current) {
            try {
                sessionRef.current.close();
            } catch (e) { console.error("Error closing session:", e); }
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
            } catch (e) { console.error("Error closing AudioContext:", e); }
            audioContextRef.current = null;
        }

    }, []);

    const startListening = useCallback(async () => {
        if (isListening) return;
        setIsListening(true);
        setError(null);
        setFinalizedTranscription('');
        setInProgressTranscription('');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            const ai = new GoogleGenAI({ apiKey: API_KEY });
            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        console.log('Gemini Live session opened.');
                        if (!mediaStreamRef.current) return;
                        
                        const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        audioContextRef.current = context;
                        const source = context.createMediaStreamSource(mediaStreamRef.current);
                        mediaStreamSourceRef.current = source;
                        const processor = context.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current = processor;

                        processor.onaudioprocess = (e) => {
                            const pcmBlob: Blob = createBlob(e.inputBuffer.getChannelData(0));
                            sessionPromise.then((session) => session?.sendRealtimeInput({ media: pcmBlob }));
                        };
                        source.connect(processor);
                        processor.connect(context.destination);
                    },
                    onmessage: (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const result = message.serverContent.inputTranscription;
                            const text = result.text;
    
                            if (result.isFinal) {
                                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                                // Use functional updates to get the latest state and avoid stale closures
                                setInProgressTranscription(currentInProgress => {
                                    setFinalizedTranscription(currentFinalized => (currentFinalized + currentInProgress + text).trim() + ' ');
                                    return ''; // Reset in-progress
                                });
                            } else {
                                setInProgressTranscription(prev => prev + text);
                                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                                // Use a timeout with a functional update to finalize after a pause
                                silenceTimerRef.current = setTimeout(() => {
                                    setInProgressTranscription(currentInProgress => {
                                        if (currentInProgress.trim()) {
                                            setFinalizedTranscription(currentFinalized => (currentFinalized + currentInProgress.trim() + ' ').replace(/\s\s+/g, ' '));
                                        }
                                        return '';
                                    });
                                }, SILENCE_THRESHOLD_MS);
                            }
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        setError('An error occurred. Please check the console.');
                        stopListening();
                    },
                    onclose: (e: CloseEvent) => {
                        // Use ref to get the latest state and avoid stale closures
                        if (isListeningRef.current) {
                           console.log('Session closed unexpectedly.');
                           stopListening();
                        }
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
             if (err instanceof DOMException && err.name === 'NotAllowedError') {
                 setError('Could not access the microphone. Please grant permission and try again.');
            } else {
                 setError('Failed to start transcription. Please check microphone permissions and refresh the page.');
            }
            setIsListening(false);
        }

    }, [isListening, stopListening]);

    const handleToggleListening = () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    };
    
    useEffect(() => {
        return () => { stopListening(); };
    }, [stopListening]);

    const buttonText = isListening ? 'Stop Listening' : 'Start Listening';

    return (
        <div className="flex flex-col items-center justify-start min-h-screen bg-gray-900 text-gray-100 p-4 sm:p-6 md:p-8 font-sans">
            <div className="w-full max-w-4xl mx-auto flex flex-col h-full">
                <header className="text-center mb-6">
                    <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-400">
                        Gemini Live Transcriber
                    </h1>
                </header>

                <main className="flex-grow flex flex-col bg-gray-800/50 rounded-lg shadow-2xl border border-gray-700 overflow-hidden mt-12">
                    <div className="flex-grow p-4 sm:p-6 overflow-y-auto">
                        <div className="w-full h-full min-h-[300px] bg-transparent text-gray-200 text-lg resize-none focus:outline-none placeholder-gray-500">
                            <span>{finalizedTranscription}</span>
                            <span className="text-teal-300">{inProgressTranscription}</span>
                        </div>
                    </div>
                </main>

                {error && <div className="text-red-400 mt-4 text-center">{error}</div>}

                <footer className="mt-8 text-center">
                    <button
                        onClick={handleToggleListening}
                        className={`px-8 py-4 text-lg font-semibold rounded-full shadow-lg transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-opacity-50
                            ${isListening 
                                ? 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500' 
                                : 'bg-teal-500 hover:bg-teal-600 text-white focus:ring-teal-400'
                            }
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
