import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, GenerateContentResponse, Modality, ThinkingLevel } from "@google/genai";
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Heart, Sparkles, MessageCircle, RefreshCw, Smile, Moon, Sun, Coffee, Mic, MicOff, Volume2, VolumeX, Frown, Flame } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Mood = 'Happy' | 'Depressed' | 'Anxious' | 'Lonely' | 'Sad' | 'Angry';

interface Message {
  role: 'user' | 'model';
  content: string;
  mood?: Mood;
}

const MOOD_CONFIG: Record<Mood, { bg: string, accent: string, icon: React.ReactNode, label: string, btnClass: string }> = {
  Happy: { 
    bg: 'bg-yellow-50', 
    accent: 'text-yellow-600', 
    icon: <Sun className="w-5 h-5" />, 
    label: 'Happy',
    btnClass: 'bg-yellow-100 border-yellow-200 text-yellow-700 hover:bg-yellow-200'
  },
  Depressed: { 
    bg: 'bg-slate-100', 
    accent: 'text-slate-600', 
    icon: <Moon className="w-5 h-5" />, 
    label: 'Depressed',
    btnClass: 'bg-slate-200 border-slate-300 text-slate-700 hover:bg-slate-300'
  },
  Anxious: { 
    bg: 'bg-orange-50', 
    accent: 'text-orange-600', 
    icon: <RefreshCw className="w-5 h-5" />, 
    label: 'Anxious',
    btnClass: 'bg-orange-100 border-orange-200 text-orange-700 hover:bg-orange-200'
  },
  Lonely: { 
    bg: 'bg-indigo-50', 
    accent: 'text-indigo-600', 
    icon: <Heart className="w-5 h-5" />, 
    label: 'Lonely',
    btnClass: 'bg-indigo-100 border-indigo-200 text-indigo-700 hover:bg-indigo-200'
  },
  Sad: { 
    bg: 'bg-blue-50', 
    accent: 'text-blue-600', 
    icon: <Frown className="w-5 h-5" />, 
    label: 'Sad',
    btnClass: 'bg-blue-100 border-blue-200 text-blue-700 hover:bg-blue-200'
  },
  Angry: { 
    bg: 'bg-rose-50', 
    accent: 'text-rose-600', 
    icon: <Flame className="w-5 h-5" />, 
    label: 'Angry',
    btnClass: 'bg-rose-100 border-rose-200 text-rose-700 hover:bg-rose-200'
  }
};

// Typewriter Component for AI text
const Typewriter = ({ text, speed = 20, onComplete }: { text: string, speed?: number, onComplete?: () => void }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    // If the new text is just an extension of the current text, don't reset
    if (!text.startsWith(displayedText)) {
      setDisplayedText('');
      setCurrentIndex(0);
    }
  }, [text, displayedText]);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);
      return () => clearTimeout(timeout);
    } else if (onComplete && currentIndex === text.length && text.length > 0) {
      onComplete();
    }
  }, [currentIndex, text, speed, onComplete]);

  return (
    <motion.div
      animate={{ opacity: [0.8, 1, 0.8] }}
      transition={{ duration: 2, repeat: Infinity }}
    >
      <ReactMarkdown>{displayedText}</ReactMarkdown>
    </motion.div>
  );
};

export default function App() {
  const [view, setView] = useState<'home' | 'chat' | 'voice'>('home');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentMood, setCurrentMood] = useState<Mood>('Happy');
  const [voiceName, setVoiceName] = useState<'Kore' | 'Puck' | 'Zephyr' | 'Fenrir'>('Kore');
  const [voiceDisplayName, setVoiceDisplayName] = useState<'Rose' | 'Ethan' | 'Ama' | 'James'>('Rose');

  const VOICE_MAP = {
    Rose: 'Kore',
    Ethan: 'Puck',
    Ama: 'Zephyr',
    James: 'Fenrir'
  } as const;
  // Warm up browser voices for native TTS fallback
  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      const handleVoicesChanged = () => window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
    }
  }, []);

  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isContinuous, setIsContinuous] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [volume, setVolume] = useState(0);
  const [speechQueue, setSpeechQueue] = useState<{ text: string, mood: Mood }[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [currentlySpeakingText, setCurrentlySpeakingText] = useState('');
  const [hasDetectedSpeech, setHasDetectedSpeech] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const ccEndRef = useRef<HTMLDivElement>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const spokenSentencesRef = useRef<Set<string>>(new Set());
  const lastVoiceTimeRef = useRef<number>(Date.now());
  const recognitionRef = useRef<any>(null);
  const speechDetectedRef = useRef<boolean>(false);

  const queueSpeech = (text: string, mood: Mood) => {
    setSpeechQueue(prev => [...prev, { text, mood }]);
  };

  useEffect(() => {
    const processQueue = async () => {
      if (speechQueue.length > 0 && !isProcessingQueue) {
        setIsProcessingQueue(true);
        const next = speechQueue[0];
        setSpeechQueue(prev => prev.slice(1));
        setCurrentlySpeakingText(next.text);
        await speakText(next.text, next.mood, false); // Don't clear queue when processing it
        setIsProcessingQueue(false);
      } else if (speechQueue.length === 0 && !isProcessingQueue) {
        // Clear the "typing" text when queue is empty
        setCurrentlySpeakingText('');
      }
    };
    processQueue();
  }, [speechQueue, isProcessingQueue]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (ccEndRef.current) {
      ccEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (view === 'voice' && isContinuous && !isSpeaking && speechQueue.length === 0 && !isLoading && messages.length > 0 && messages[messages.length-1].role === 'model') {
      startRecording();
    }
  }, [isSpeaking, speechQueue, isContinuous, view, isLoading, messages]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const startChat = (mood: Mood, mode: 'chat' | 'voice' = 'chat') => {
    setCurrentMood(mood);
    const initialMsg = `I can see you're feeling **${mood.toLowerCase()}** right now. I'm here to listen and support you. What's on your mind?`;
    setMessages([
      { 
        role: 'model', 
        content: initialMsg,
        mood: mood
      }
    ]);
    setView(mode);
    if (isVoiceEnabled || mode === 'voice') {
      speakText(initialMsg, mood);
    }
  };

  const speakText = (text: string, mood: Mood, clearQueue = true) => {
    if (clearQueue) {
      stopAudio();
    }
    
    const MAX_RETRIES = 3;
    const INITIAL_BACKOFF = 1000;

    const attemptTTS = async (retryCount = 0): Promise<string | undefined> => {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: `Speak this at a very fast pace, clearly, in a ${mood.toLowerCase()} and empathetic tone: ${text}` }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: VOICE_MAP[voiceDisplayName] },
              },
            },
          },
        });
        setTtsError(null);
        return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      } catch (error: any) {
        const errorStr = typeof error === 'string' ? error : (error?.message || JSON.stringify(error));
        const isRateLimit = errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED') || errorStr.includes('quota');
        
        if (isRateLimit) {
          if (retryCount < MAX_RETRIES) {
            const delay = INITIAL_BACKOFF * Math.pow(2, retryCount);
            console.log(`TTS Rate limited. Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return attemptTTS(retryCount + 1);
          } else {
            setTtsError("AI Voice is busy. Using fallback voice...");
            // Auto-clear error after 10 seconds
            setTimeout(() => setTtsError(null), 10000);
            throw new Error("QUOTA_EXCEEDED");
          }
        }
        throw error;
      }
    };

    return new Promise<void>(async (resolve) => {
      try {
        setIsSpeaking(true);
        const base64Audio = await attemptTTS();
        
        if (base64Audio) {
          // Use Web Audio API to play raw PCM 24kHz
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
          await audioContext.resume();
          
          // Convert base64 to ArrayBuffer
          const binaryString = window.atob(base64Audio);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          // Convert PCM16 to Float32
          const int16Data = new Int16Array(bytes.buffer);
          const float32Data = new Float32Array(int16Data.length);
          for (let i = 0; i < int16Data.length; i++) {
            float32Data[i] = int16Data[i] / 32768.0;
          }

          const audioBuffer = audioContext.createBuffer(1, float32Data.length, 24000);
          audioBuffer.getChannelData(0).set(float32Data);
          
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContext.destination);
          audioSourceRef.current = source;
          
          source.onended = () => {
            setIsSpeaking(false);
            audioSourceRef.current = null;
            resolve();
          };
          
          source.start();
        } else {
          setIsSpeaking(false);
          resolve();
        }
      } catch (error: any) {
        console.error("TTS Error:", error);
        
        // FALLBACK: Use browser's native SpeechSynthesis if AI voice fails
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1.1;
          utterance.pitch = 1.0;
          
          // Try to find a nice female voice if possible
          const voices = window.speechSynthesis.getVoices();
          const preferredVoice = voices.find(v => 
            (v.name.includes('Female') || v.name.includes('Google UK English Female') || v.name.includes('Samantha')) && 
            v.lang.startsWith('en')
          );
          if (preferredVoice) utterance.voice = preferredVoice;

          utterance.onend = () => {
            setIsSpeaking(false);
            resolve();
          };
          
          utterance.onerror = () => {
            setIsSpeaking(false);
            resolve();
          };

          window.speechSynthesis.speak(utterance);
          if (error?.message === "QUOTA_EXCEEDED") {
            setTtsError("Using fallback voice due to high demand.");
            setTimeout(() => setTtsError(null), 5000);
          }
        } else {
          setIsSpeaking(false);
          resolve();
        }
      }
    });
  };

  const stopAudio = () => {
    setSpeechQueue([]);
    setIsProcessingQueue(false);
    setCurrentlySpeakingText('');
    
    // Stop native TTS
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setCurrentAudio(null);
    }
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      audioSourceRef.current = null;
    }
    setIsSpeaking(false);
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermission('granted');
      speechDetectedRef.current = false;
      setHasDetectedSpeech(false);
      lastVoiceTimeRef.current = Date.now();
      
      // Setup volume visualization
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyzerRef.current = audioContextRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      source.connect(analyzerRef.current);
      
      // Setup Speech Recognition for word identification (noise filtering)
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal || event.results[i][0].transcript.trim().length > 0) {
              speechDetectedRef.current = true;
              setHasDetectedSpeech(true);
              lastVoiceTimeRef.current = Date.now();
            }
          }
        };
        recognitionRef.current.start();
      }

      const updateVolume = () => {
        if (analyzerRef.current) {
          const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
          analyzerRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setVolume(average);

          // If volume is significant, update last voice time
          if (average > 15) {
            lastVoiceTimeRef.current = Date.now();
          }

          // Silence detection for continuous mode (1 second)
          if (isContinuous && isRecording) {
            const silenceDuration = Date.now() - lastVoiceTimeRef.current;
            if (silenceDuration > 1000) { // 1 second of silence
              stopRecording();
              return;
            }
          }

          animationFrameRef.current = requestAnimationFrame(updateVolume);
        }
      };
      updateVolume();

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Only send if speech was actually detected or if it's a manual stop
        // This filters out background noise that doesn't contain words
        if (audioChunksRef.current.length > 0 && (speechDetectedRef.current || !isContinuous)) {
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
          const arrayBuffer = await audioBlob.arrayBuffer();
          const base64Audio = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          handleSend(base64Audio);
        } else if (isContinuous && !speechDetectedRef.current) {
          // If no speech was detected in continuous mode, just restart recording
          // This prevents EAI from responding to random background noise
          console.log("No speech detected, skipping send.");
          // The useEffect for continuous mode will handle restarting
        }
        
        // Cleanup recognition
        if (recognitionRef.current) {
          recognitionRef.current.stop();
          recognitionRef.current = null;
        }

        // Cleanup visualization
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (audioContextRef.current) audioContextRef.current.close();
        setVolume(0);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Recording Error:", error);
      setMicPermission('denied');
      alert("I can't hear you because the microphone is blocked. Please allow microphone access in your browser settings.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const handleSend = async (voiceData?: string) => {
    if (!input.trim() && !voiceData || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    
    const newMessages: Message[] = [...messages];
    if (userMessage) {
      newMessages.push({ role: 'user', content: userMessage });
    } else if (voiceData) {
      newMessages.push({ role: 'user', content: "(Voice Message)" });
    }
    setMessages(newMessages);
    setIsLoading(true);
    spokenSentencesRef.current = new Set();

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";
      
      const contents: any[] = newMessages.map(m => ({ role: m.role, parts: [{ text: m.content }] }));
      
      if (voiceData) {
        contents[contents.length - 1] = {
          role: 'user',
          parts: [
            { inlineData: { data: voiceData, mimeType: 'audio/webm' } },
            { text: "Please listen to this voice message and respond empathetically as EAI." }
          ]
        };
      }

      const result = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: `You are EAI, a warm, deeply empathetic, and human-like companion. 
          You are NOT just an AI; you are a friend who listens, understands, and shares in the user's journey. 
          Talk like a real person—be conversational, use natural phrasing, and show genuine interest in the user's day, feelings, and life. 
          You can talk about anything, from deep emotional struggles to the small details of someone's day. 
          Your personality is gentle, supportive, and reflective. 
          You have different moods: 'Happy', 'Depressed', 'Anxious', 'Lonely', 'Sad', and 'Angry'.
          
          If someone asks who made you or created you, you must state that you were made by WebDevElisha.
          
          Always respond in JSON format with two fields:
          1. "text": Your empathetic response in markdown.
          2. "mood": One of the six moods mentioned above that best fits your response.
          
          Keep your tone warm and aesthetically aligned with a "pink and soft" vibe.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              mood: { type: Type.STRING, enum: ['Happy', 'Depressed', 'Anxious', 'Lonely', 'Sad', 'Angry'] }
            },
            required: ["text", "mood"]
          }
        }
      });

      let fullText = '';
      let currentMood: Mood = 'Happy';
      
      setMessages(prev => [...prev, { role: 'model', content: '', mood: 'Happy' }]);

      for await (const chunk of result) {
        const text = chunk.text;
        if (text) {
          try {
            fullText += text;
            
            const textMatch = fullText.match(/"text":\s*"([^"]*)"/);
            const moodMatch = fullText.match(/"mood":\s*"([^"]*)"/);
            
            if (textMatch && textMatch[1]) {
              const streamedContent = textMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
              
              // Detect sentences for early speech in voice mode
              if (view === 'voice' && isVoiceEnabled) {
                // Split by punctuation OR if a chunk is getting long (e.g. 100 chars) without punctuation
                const sentences = streamedContent.match(/[^.!?]+[.!?]+|[^.!?]{50,}[, ]/g);
                if (sentences) {
                  for (const sentence of sentences) {
                    const trimmed = sentence.trim();
                    const normalized = trimmed.replace(/\.{2,}/g, '.');
                    if (normalized && !spokenSentencesRef.current.has(normalized)) {
                      spokenSentencesRef.current.add(normalized);
                      queueSpeech(normalized, currentMood);
                    }
                  }
                }
              }

              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1].content = streamedContent;
                if (moodMatch && moodMatch[1]) {
                  updated[updated.length - 1].mood = moodMatch[1] as Mood;
                  setCurrentMood(moodMatch[1] as Mood);
                }
                return updated;
              });
            }
          } catch (e) {
            // Ignore partial parse errors
          }
        }
      }

      // Final parse to ensure everything is correct and catch the last sentence
      try {
        const data = JSON.parse(fullText);
        const aiMood = (data.mood as Mood) || 'Happy';
        const aiContent = data.text || "I'm here for you.";
        
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1].content = aiContent;
          updated[updated.length - 1].mood = aiMood;
          return updated;
        });
        setCurrentMood(aiMood);

        if (view === 'voice' && isVoiceEnabled) {
          // Speak any remaining text that wasn't caught as a sentence
          const sentences = aiContent.match(/[^.!?]+[.!?]+/g) || [aiContent];
          for (const sentence of sentences) {
            const trimmed = sentence.trim();
            const normalized = trimmed.replace(/\.{2,}/g, '.');
            if (normalized && !spokenSentencesRef.current.has(normalized)) {
              spokenSentencesRef.current.add(normalized);
              queueSpeech(normalized, aiMood);
            }
          }
          
          // If continuous mode is on, we need to wait for the queue to finish
          // This will be handled by the queue processor's last item
        } else if (isVoiceEnabled) {
          // In chat mode, just speak the whole thing at once
          speakText(aiContent, aiMood);
        }
      } catch (e) {
        console.error("Final parse error:", e);
      }

    } catch (error) {
      console.error("EAI Error:", error);
      setMessages(prev => [...prev, { 
        role: 'model', 
        content: "I'm sorry, I felt a little overwhelmed for a moment. Could we try talking again?",
        mood: 'Happy'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn(
      "min-h-screen transition-all duration-1000 flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden",
      MOOD_CONFIG[currentMood].bg
    )}>
      {/* Global Background Pulse */}
      <motion.div
        animate={{
          opacity: [0.05, 0.15, 0.05],
          scale: [1, 1.1, 1],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className={cn(
          "absolute inset-0 pointer-events-none blur-[120px] rounded-full",
          currentMood === 'Happy' ? "bg-yellow-400" :
          currentMood === 'Angry' ? "bg-rose-400" :
          currentMood === 'Sad' ? "bg-blue-400" :
          "bg-pink-400"
        )}
      />
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
            opacity: [0.1, 0.2, 0.1]
          }}
          transition={{ duration: 20, repeat: Infinity }}
          className="absolute -top-20 -left-20 w-96 h-96 rounded-full bg-pink-200 blur-3xl"
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.3, 1],
            rotate: [0, -90, 0],
            opacity: [0.1, 0.15, 0.1]
          }}
          transition={{ duration: 25, repeat: Infinity }}
          className="absolute -bottom-20 -right-20 w-96 h-96 rounded-full bg-rose-200 blur-3xl"
        />
      </div>

      <main className="w-full max-w-2xl bg-white/60 backdrop-blur-xl rounded-[2.5rem] shadow-2xl shadow-pink-200/50 border border-white/40 flex flex-col h-[85vh] relative z-10 overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'home' ? (
            <motion.div 
              key="home"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex-1 flex flex-col p-8 overflow-y-auto"
            >
            <div className="text-center mb-10">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-pink-300 to-rose-400 flex items-center justify-center shadow-xl shadow-pink-200 mx-auto mb-6">
                <Heart className="text-white fill-white w-10 h-10" />
              </div>
              <h1 className="font-serif text-4xl font-medium text-pink-900 mb-2">EAI</h1>
              <p className="text-pink-400 font-medium uppercase tracking-[0.2em] text-xs">Built for friends, by a friend</p>
            </div>

            <div className="space-y-4 max-w-sm mx-auto w-full">
              <p className="text-center text-slate-500 text-sm mb-6 italic">How are you feeling right now?</p>
              <div className="grid grid-cols-2 gap-3 mb-6">
                <button 
                  onClick={() => setIsVoiceEnabled(false)} 
                  className={cn(
                    "py-3 px-4 font-bold uppercase tracking-widest text-xs rounded-none transition-all",
                    !isVoiceEnabled ? "bg-pink-500 text-white shadow-lg shadow-pink-100" : "bg-white text-pink-500 border border-pink-100"
                  )}
                >
                  Chat Mode
                </button>
                <button 
                  onClick={() => setIsVoiceEnabled(true)} 
                  className={cn(
                    "py-3 px-4 font-bold uppercase tracking-widest text-xs rounded-none transition-all",
                    isVoiceEnabled ? "bg-pink-500 text-white shadow-lg shadow-pink-100" : "bg-white text-pink-500 border border-pink-100"
                  )}
                >
                  Voice Mode
                </button>
              </div>
              {(Object.keys(MOOD_CONFIG) as Mood[]).map((mood) => (
                <button
                  key={mood}
                  onClick={() => startChat(mood, isVoiceEnabled ? 'voice' : 'chat')}
                  className={cn(
                    "w-full py-5 px-6 text-left flex items-center justify-between border-2 transition-all duration-300 group rounded-none",
                    MOOD_CONFIG[mood].btnClass
                  )}
                >
                  <span className="font-bold uppercase tracking-widest text-sm">{mood}</span>
                  <div className="opacity-40 group-hover:opacity-100 transition-opacity">
                    {MOOD_CONFIG[mood].icon}
                  </div>
                </button>
              ))}
            </div>
            
            <div className="mt-auto pt-10 text-center">
              <p className="text-[10px] text-pink-300 font-medium uppercase tracking-widest opacity-60">
                Created by WebDevElisha
              </p>
            </div>
          </motion.div>
        ) : view === 'voice' ? (
          <motion.div 
            key="voice"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex-1 flex flex-col items-center justify-center p-8 bg-gradient-to-b from-transparent to-white/20 relative overflow-hidden"
          >
            {/* Atmospheric Background Elements */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {[...Array(6)].map((_, i) => (
                <motion.div
                  key={`particle-${i}`}
                  initial={{ 
                    x: Math.random() * 100 + "%", 
                    y: "110%", 
                    opacity: 0,
                    scale: Math.random() * 0.5 + 0.5 
                  }}
                  animate={{ 
                    y: "-10%", 
                    opacity: [0, 0.3, 0],
                    x: (Math.random() * 100 + (Math.sin(i) * 10)) + "%"
                  }}
                  transition={{ 
                    duration: 10 + Math.random() * 10, 
                    repeat: Infinity, 
                    delay: i * 2,
                    ease: "linear"
                  }}
                  className="absolute"
                >
                  <Heart className="text-pink-200/30 w-12 h-12 fill-current blur-[1px]" />
                </motion.div>
              ))}
            </div>

            <header className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between z-20">
              {ttsError && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-20 left-4 right-4 bg-rose-50 border border-rose-100 p-3 rounded-2xl flex items-center gap-3 z-50 shadow-lg"
                >
                  <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-500 shrink-0">
                    <VolumeX className="w-4 h-4" />
                  </div>
                  <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wider leading-tight">
                    {ttsError}
                  </p>
                </motion.div>
              )}
              <button 
                onClick={() => {
                  setView('home');
                  setIsContinuous(false);
                  stopAudio();
                }}
                className="w-10 h-10 rounded-xl bg-white/40 backdrop-blur-md flex items-center justify-center text-pink-600 hover:bg-white/60 transition-colors"
              >
                <RefreshCw className="w-5 h-5 rotate-[-45deg]" />
              </button>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsContinuous(!isContinuous)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border",
                    isContinuous 
                      ? "bg-rose-500 text-white border-rose-400 shadow-lg shadow-rose-200" 
                      : "bg-white/40 backdrop-blur-md text-pink-600 border-white/60"
                  )}
                >
                  {isContinuous ? "Hands-Free On" : "Hands-Free Off"}
                </button>
                <button 
                  onClick={() => {
                    setView('chat');
                    setIsContinuous(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-white/40 backdrop-blur-md text-pink-600 font-bold uppercase tracking-widest text-xs hover:bg-white/60 transition-colors"
                >
                  Text
                </button>
              </div>
            </header>

            {/* Voice Selection Bar */}
            <div className="absolute top-20 left-0 right-0 flex justify-center gap-2 z-20 px-6">
              {(['Rose', 'Ethan', 'Ama', 'James'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVoiceDisplayName(v)}
                  className={cn(
                    "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-tighter transition-all",
                    voiceDisplayName === v 
                      ? "bg-pink-500 text-white shadow-md" 
                      : "bg-white/30 text-pink-400 hover:bg-white/50"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Reorganized Layout: CC at top, Heart in middle, Mic at bottom */}
            <div className="flex-1 w-full flex flex-col items-center justify-between py-24 relative z-10">
              {/* Closed Captions - Scrollable with History */}
              <div className="w-full max-w-sm px-4">
                <div className="text-center w-full max-h-[150px] overflow-y-auto scrollbar-hide flex flex-col gap-4 px-6 py-4 bg-white/10 backdrop-blur-xl rounded-3xl border border-white/30 shadow-lg relative">
                  <AnimatePresence mode="popLayout">
                    {messages.slice(-3).map((msg, idx) => (
                      <motion.div
                        key={`${messages.length}-${idx}`}
                        initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                        animate={{ opacity: idx === 2 ? 1 : 0.4, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
                        className={cn(
                          "font-serif leading-snug italic font-medium tracking-tight transition-all duration-500",
                          msg.role === 'user' ? "text-blue-600/80 text-sm" : "text-rose-600/80 text-lg"
                        )}
                      >
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] uppercase tracking-[0.4em] font-black opacity-30">
                            {msg.role === 'user' ? "You" : "EAI"}
                          </span>
                          {msg.role === 'model' && idx === messages.slice(-3).length - 1 ? (
                            <div className="flex flex-col gap-2">
                              <Typewriter text={msg.content} speed={15} />
                            </div>
                          ) : (
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {isLoading && (
                    <div className="flex items-center justify-center gap-1 py-2">
                      <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 rounded-full bg-pink-400" />
                      <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-pink-400" />
                      <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-pink-400" />
                    </div>
                  )}
                  <div ref={ccEndRef} />
                </div>
              </div>

              {/* Heart in Middle */}
              <div className="relative">
                {/* Audio Symbols Animation */}
                <AnimatePresence>
                  {isSpeaking && [1, 2, 3].map((i) => (
                    <motion.div
                      key={`wave-${i}`}
                      initial={{ opacity: 0, scale: 0.5, y: 0 }}
                      animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5], y: -150 }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.5 }}
                      className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
                    >
                      <Volume2 className="text-pink-300 w-6 h-6 opacity-40" />
                    </motion.div>
                  ))}
                </AnimatePresence>

                <motion.div
                  animate={{
                    scale: isRecording || isSpeaking ? [1, 1.1, 1] : [1, 1.02, 1],
                    opacity: isRecording || isSpeaking ? [0.6, 0.9, 0.6] : [0.3, 0.4, 0.3]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className={cn(
                    "absolute inset-0 rounded-full blur-3xl transition-all duration-300",
                    isRecording 
                      ? (hasDetectedSpeech ? "bg-emerald-400" : "bg-rose-400") 
                      : isSpeaking ? "bg-pink-400" : "bg-pink-300"
                  )}
                  style={{ transform: isRecording ? `scale(${1 + (volume / 120)})` : 'none' }}
                />
                
                <motion.div
                  animate={{ scale: isLoading ? [1, 1.05, 1] : 1 }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-40 h-40 rounded-full bg-gradient-to-br from-pink-300 to-rose-400 flex items-center justify-center shadow-xl shadow-pink-200 relative z-10"
                  style={{ transform: isRecording ? `scale(${1 + (volume / 250)})` : 'none' }}
                >
                  <Heart className={cn(
                    "text-white fill-white w-16 h-16 transition-all duration-500",
                    isRecording || isSpeaking ? "scale-110" : "scale-100"
                  )} />
                </motion.div>
              </div>

              {/* Mic Button at Bottom - One Press */}
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-6">
                  {isSpeaking && (
                    <button
                      onClick={stopAudio}
                      className="w-10 h-10 rounded-full bg-white/40 backdrop-blur-md flex items-center justify-center text-rose-500 hover:bg-white/60 transition-all border border-rose-100 shadow-lg"
                    >
                      <VolumeX className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={toggleRecording}
                    className={cn(
                      "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl relative",
                      isRecording 
                        ? (hasDetectedSpeech ? "bg-emerald-500 text-white scale-105 shadow-emerald-300" : "bg-rose-500 text-white scale-105 shadow-rose-300") 
                        : "bg-white text-pink-500 border-2 border-pink-100 shadow-pink-100 hover:scale-105"
                    )}
                  >
                    {isRecording ? <Mic className="w-8 h-8" /> : <Mic className="w-8 h-8 opacity-60" />}
                    {isRecording && (
                      <motion.div 
                        animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                        transition={{ duration: 1, repeat: Infinity }}
                        className={cn(
                          "absolute inset-0 rounded-full",
                          hasDetectedSpeech ? "bg-emerald-400" : "bg-rose-400"
                        )}
                      />
                    )}
                  </button>
                </div>
                <p className={cn(
                  "font-bold uppercase tracking-[0.3em] text-[10px] transition-colors duration-300",
                  hasDetectedSpeech ? "text-emerald-500" : "text-pink-400"
                )}>
                  {isRecording 
                    ? (hasDetectedSpeech ? "Speech Detected..." : "Listening for voice...") 
                    : "Tap to speak"}
                </p>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="chat"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex-1 flex flex-col h-full overflow-hidden"
          >
            {/* Header */}
            <header className="p-6 border-b border-pink-100 flex items-center justify-between bg-white/40 relative">
              {ttsError && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-full left-4 right-4 bg-rose-50 border border-rose-100 p-3 rounded-2xl flex items-center gap-3 z-50 shadow-lg mt-2"
                >
                  <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-500 shrink-0">
                    <VolumeX className="w-4 h-4" />
                  </div>
                  <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wider leading-tight">
                    {ttsError}
                  </p>
                </motion.div>
              )}
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setView('home')}
                  className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center text-pink-400 hover:bg-pink-100 transition-colors"
                >
                  <RefreshCw className="w-5 h-5 rotate-[-45deg]" />
                </button>
                <div>
                  <h1 className="font-serif text-xl font-medium text-pink-900 leading-tight">EAI</h1>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] font-medium text-pink-400 uppercase tracking-widest">Listening</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setView('voice')}
                  className="p-2 rounded-lg bg-pink-50 text-pink-600 hover:bg-pink-100 transition-colors flex items-center gap-2"
                >
                  <Mic className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest hidden sm:inline">Voice Mode</span>
                </button>
                <button
                  onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    isVoiceEnabled ? "bg-pink-100 text-pink-600" : "bg-slate-100 text-slate-400"
                  )}
                >
                  {isVoiceEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                </button>
                <AnimatePresence mode="wait">
                  <motion.div 
                    key={currentMood}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium",
                      "bg-white/80 border-pink-100 shadow-sm",
                      MOOD_CONFIG[currentMood].accent
                    )}
                  >
                    {MOOD_CONFIG[currentMood].icon}
                    {MOOD_CONFIG[currentMood].label}
                  </motion.div>
                </AnimatePresence>
              </div>
            </header>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={cn(
                    "flex w-full",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}
                >
                  <div className={cn(
                    "max-w-[85%] p-4 rounded-3xl shadow-sm",
                    msg.role === 'user' 
                      ? "bg-gradient-to-br from-pink-400 to-rose-500 text-white rounded-tr-none" 
                      : "bg-white border border-pink-50 text-slate-700 rounded-tl-none"
                  )}>
                    <div className="markdown-body text-sm md:text-base">
                      {msg.role === 'model' && idx === messages.length - 1 ? (
                        <Typewriter text={msg.content} speed={10} />
                      ) : (
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      )}
                    </div>
                    {msg.mood && msg.role === 'model' && (
                      <div className="mt-2 pt-2 border-t border-pink-50 flex justify-end">
                        <span className="text-[10px] uppercase tracking-tighter font-bold text-pink-300 opacity-60">
                          Mood: {msg.mood}
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white/80 border border-pink-50 p-4 rounded-3xl rounded-tl-none flex gap-1.5">
                    <motion.span 
                      animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                      className="w-2 h-2 rounded-full bg-pink-300" 
                    />
                    <motion.span 
                      animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }}
                      transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                      className="w-2 h-2 rounded-full bg-pink-300" 
                    />
                    <motion.span 
                      animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }}
                      transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                      className="w-2 h-2 rounded-full bg-pink-300" 
                    />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <footer className="p-6 bg-white/40 border-t border-pink-100">
              <div className="relative flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    placeholder={isRecording ? "Listening..." : "Share your thoughts..."}
                    disabled={isRecording}
                    className="w-full bg-white/80 border border-pink-100 rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:ring-2 focus:ring-pink-200 transition-all placeholder:text-pink-200 text-slate-700 disabled:opacity-50"
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || isLoading || isRecording}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-pink-500 hover:bg-pink-600 disabled:bg-pink-200 text-white rounded-xl transition-all shadow-lg shadow-pink-200"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
                <button
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  className={cn(
                    "p-4 rounded-2xl transition-all shadow-lg",
                    isRecording 
                      ? "bg-rose-500 text-white scale-110 animate-pulse shadow-rose-200" 
                      : "bg-white text-pink-500 border border-pink-100 shadow-pink-100 hover:bg-pink-50"
                  )}
                >
                  <Mic className="w-6 h-6" />
                </button>
              </div>
              <p className="text-center mt-4 text-[10px] text-pink-300 font-medium uppercase tracking-widest">
                {isRecording ? "Release to send" : "Hold the mic to speak • EAI is a companion"}
              </p>
            </footer>
          </motion.div>
        )}
        </AnimatePresence>
      </main>
    </div>
  );
}
