"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Mic,
  Square,
  X,
  Send,
  Sparkles,
  RotateCcw,
  TrendingUp,
  ShieldCheck,
  MessageSquareText,
  Volume2,
} from "lucide-react";
import { RichMessageContent } from "./rich-message-content";
import { extractClientScreenSnapshot } from "@/lib/voice/context-extractor";
import { ChatTurn, ScreenSnapshot, VoiceTalkResponse } from "@/lib/voice/types";

interface ChatBubbleMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioUrl?: string;
}

export function FloatingVoiceAssistant() {
  // isOpen: true (chat window open) | false (floating bottom pill)
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [voiceStatus, setVoiceStatus] = useState<string>("");

  const [chatMessages, setChatMessages] = useState<ChatBubbleMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Namaste! I'm your MyStockVision Research Co-Pilot. You can type or tap the microphone to ask anything about this stock or Indian market trends in plain words.",
    },
  ]);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string>("");

  const chatSessionIdRef = useRef<string>("");
  const chatHistoryRef = useRef<ChatTurn[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const isMutedRef = useRef<boolean>(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const currentUtteranceRef = useRef<string>("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      chatSessionIdRef.current = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = "en-IN";

        recognition.onresult = (event: any) => {
          let fullTranscript = "";
          for (let i = 0; i < event.results.length; i++) {
            const item = event.results[i];
            if (item && item[0]) {
              fullTranscript += item[0].transcript + " ";
            }
          }
          const clean = fullTranscript.trim();
          if (clean) {
            currentUtteranceRef.current = clean;
            setVoiceStatus(clean);
          }
        };

        recognition.onerror = () => {
          // ignore silent errors
        };

        speechRecognitionRef.current = recognition;
      }
    }

    return () => {
      cleanupAudio();
    };
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, chatLoading, isOpen]);

  const cleanupAudio = () => {
    isMutedRef.current = true;
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.abort();
      } catch {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      mediaStreamRef.current = null;
    }
    if (audioPlayerRef.current) {
      try {
        audioPlayerRef.current.pause();
        audioPlayerRef.current.src = "";
      } catch {}
    }
    setIsRecording(false);
    setVoiceStatus("");
  };

  const playResponseAudio = (base64Data: string | null, mimeType = "audio/wav") => {
    if (!base64Data) return;
    try {
      const audioUrl = `data:${mimeType};base64,${base64Data}`;
      if (!audioPlayerRef.current) {
        audioPlayerRef.current = new Audio();
      }
      const audio = audioPlayerRef.current;
      audio.src = audioUrl;
      audio.currentTime = 0;
      audio.play().catch((e) => {
        console.warn("[voice] autoplay blocked or error:", e);
      });
      // NOTE: NO RECURSIVE startListening() onended! Plays once and stops cleanly!
    } catch {}
  };

  // ── Start / Stop Recording Controlled by User ──
  const startRecording = async () => {
    cleanupAudio();
    isMutedRef.current = false;
    audioChunksRef.current = [];
    currentUtteranceRef.current = "";
    setVoiceStatus("Listening…");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.start();
        } catch {}
      }

      const supportedMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        if (speechRecognitionRef.current) {
          try {
            speechRecognitionRef.current.stop();
          } catch {}
        }
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        setIsRecording(false);
        setVoiceStatus("");

        if (isMutedRef.current) return;

        const spokenText = currentUtteranceRef.current.trim();
        const audioBlob =
          audioChunksRef.current.length > 0
            ? new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" })
            : null;

        if (!spokenText && (!audioBlob || audioBlob.size < 100)) {
          return; // No speech detected, quietly finish without looping
        }

        handleProcessVoiceQuery(audioBlob, spokenText);
      };

      recorder.start(250);
      setIsRecording(true);
    } catch (err) {
      console.warn("[voice] Mic error:", err);
      setIsRecording(false);
      setVoiceStatus("Mic permission denied");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
  };

  const handleProcessVoiceQuery = async (audioBlob: Blob | null, spokenText: string) => {
    setChatLoading(true);
    setChatError("");

    let base64Audio: string | undefined = undefined;
    let mimeType: string | undefined = undefined;

    if (audioBlob && audioBlob.size > 100) {
      mimeType = audioBlob.type || "audio/webm";
      base64Audio = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = (reader.result as string)?.split(",")[1] || "";
          resolve(res);
        };
        reader.readAsDataURL(audioBlob);
      });
    }

    const displayText = spokenText || "🎙️ Voice Query";
    const userMsgId = `user_${Date.now()}`;
    setChatMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", text: displayText },
    ]);

    try {
      const screenSnapshot: ScreenSnapshot = extractClientScreenSnapshot(chatSessionIdRef.current);

      const res = await fetch("/api/v1/voice/talk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: chatSessionIdRef.current,
          message: spokenText,
          audioData: base64Audio,
          mimeType,
          mode: "chat",
          history: chatHistoryRef.current.slice(-6),
          screenSnapshot,
        }),
      });

      const data: VoiceTalkResponse = await res.json();
      if (!res.ok || !data.success || !data.textReply) {
        throw new Error(data.error || "Unable to formulate a response.");
      }

      // Update user message text if Sarvam transcribed it with higher accuracy
      if (data.userQuery && data.userQuery !== spokenText) {
        setChatMessages((prev) =>
          prev.map((m) => (m.id === userMsgId ? { ...m, text: data.userQuery } : m))
        );
        chatHistoryRef.current.push({ role: "user", text: data.userQuery });
      } else {
        chatHistoryRef.current.push({ role: "user", text: displayText });
      }

      const replyAudioUrl = data.audioBase64
        ? `data:${data.audioMimeType || "audio/wav"};base64,${data.audioBase64}`
        : undefined;

      chatHistoryRef.current.push({ role: "assistant", text: data.textReply });
      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant_${Date.now()}`,
          role: "assistant",
          text: data.textReply,
          audioUrl: replyAudioUrl,
        },
      ]);

      // Play audio response once cleanly
      if (data.audioBase64) {
        playResponseAudio(data.audioBase64, data.audioMimeType || "audio/wav");
      }
    } catch (err: any) {
      console.error("[voice query] error:", err);
      setChatError(err?.message || "Failed to process voice request");
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendTextMessage = async (textToSend: string) => {
    const query = textToSend.trim();
    if (!query || chatLoading) return;

    setChatInput("");
    setChatError("");

    const userMsgId = `user_${Date.now()}`;
    setChatMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", text: query },
    ]);
    chatHistoryRef.current.push({ role: "user", text: query });
    setChatLoading(true);

    try {
      const screenSnapshot: ScreenSnapshot = extractClientScreenSnapshot(chatSessionIdRef.current);

      const res = await fetch("/api/v1/voice/talk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: chatSessionIdRef.current,
          message: query,
          mode: "chat",
          history: chatHistoryRef.current.slice(-6),
          screenSnapshot,
        }),
      });

      const data: VoiceTalkResponse = await res.json();
      if (!res.ok || !data.success || !data.textReply) {
        throw new Error(data.error || "Unable to formulate response.");
      }

      const botReply = data.textReply;
      chatHistoryRef.current.push({ role: "assistant", text: botReply });
      const replyAudioUrl = data.audioBase64
        ? `data:${data.audioMimeType || "audio/wav"};base64,${data.audioBase64}`
        : undefined;

      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant_${Date.now()}`,
          role: "assistant",
          text: botReply,
          audioUrl: replyAudioUrl,
        },
      ]);

      if (data.audioBase64) {
        playResponseAudio(data.audioBase64, data.audioMimeType || "audio/wav");
      }
    } catch (err: any) {
      setChatError(err?.message || "Failed to formulate response.");
    } finally {
      setChatLoading(false);
    }
  };

  const handleClearChat = () => {
    cleanupAudio();
    chatHistoryRef.current = [];
    chatSessionIdRef.current = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setChatMessages([
      {
        id: `cleared_${Date.now()}`,
        role: "assistant",
        text: "Conversation reset! How can I assist you with this stock or market trends?",
      },
    ]);
    setChatError("");
  };

  const handleClose = () => {
    cleanupAudio();
    setIsOpen(false);
  };

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <AnimatePresence mode="popLayout" initial={false}>
        {/* ── 1. Floating Collapsed Pill ── */}
        {!isOpen && (
          <motion.div
            key="collapsed-pill"
            layout
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="flex items-center gap-1.5 rounded-full bg-white text-zinc-900 border border-zinc-200/90 shadow-xl shadow-zinc-900/15 dark:bg-[#0f141f] dark:text-zinc-100 dark:border-zinc-800 dark:shadow-zinc-950/50 p-1.5 backdrop-blur-xl transition-all"
          >
            {/* Direct Voice Button (opens chat & starts mic) */}
            <button
              onClick={() => {
                setIsOpen(true);
                setTimeout(startRecording, 200);
              }}
              title="Speak with AI Voice Co-Pilot"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:text-white dark:hover:bg-zinc-800 text-xs font-medium transition-colors cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Voice</span>
            </button>

            <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-800" />

            {/* Direct Chat Button (opens chat window) */}
            <button
              onClick={() => setIsOpen(true)}
              title="Open Research Co-Pilot Chat"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer active:scale-95"
            >
              <MessageSquareText className="w-3.5 h-3.5" />
              <span>Chat</span>
            </button>
          </motion.div>
        )}

        {/* ── 2. Unified Institutional Chat & Voice Co-Pilot Window ── */}
        {isOpen && (
          <motion.div
            key="chat-window"
            layout
            initial={{ scale: 0.88, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.88, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 26 }}
            className="flex flex-col rounded-2xl bg-white text-zinc-900 border border-zinc-200 shadow-2xl shadow-zinc-950/20 dark:bg-[#0c1017] dark:text-zinc-100 dark:border-zinc-800 dark:shadow-black/75 backdrop-blur-2xl w-[92vw] sm:w-[480px] md:w-[530px] h-[560px] max-h-[85vh] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-[#0f141f]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-xs font-bold text-zinc-900 dark:text-white tracking-tight">
                      MyStockVision Co-Pilot
                    </h4>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[9px] font-semibold rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Live Verified
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                    Institutional Dalal Street Research
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleClearChat}
                  title="Reset conversation"
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  title="Close co-pilot"
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:text-zinc-400 dark:hover:text-red-400 dark:hover:bg-red-500/15 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Chat Message Scrollable Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-zinc-50/50 dark:bg-[#0c1017]">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                      <TrendingUp className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <div
                    className={`max-w-[88%] sm:max-w-[94%] text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-zinc-900 text-white dark:bg-emerald-600 dark:text-white rounded-2xl rounded-tr-xs px-4 py-2.5 font-medium shadow-xs whitespace-pre-wrap"
                        : "bg-white text-zinc-900 border border-zinc-200/90 shadow-2xs dark:bg-[#111622] dark:text-zinc-100 dark:border-zinc-800 rounded-2xl rounded-tl-xs px-4 py-3"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <p className="whitespace-pre-line">{msg.text}</p>
                    ) : (
                      <>
                        <RichMessageContent content={msg.text} />
                        {msg.audioUrl && (
                          <div className="mt-2.5 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60">
                            <div className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mb-1">
                              <Volume2 className="w-3 h-3" />
                              <span>Spoken Voice Reply (Sarvam AI):</span>
                            </div>
                            <audio controls src={msg.audioUrl} className="h-8 w-full max-w-[280px] rounded-lg" />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}

              {/* Typing / Thinking Indicator */}
              {chatLoading && (
                <div className="flex justify-start items-center">
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mr-2 flex-shrink-0">
                    <TrendingUp className="w-3.5 h-3.5 animate-pulse" />
                  </div>
                  <div className="bg-white border border-zinc-200/90 shadow-2xs dark:bg-[#111622] dark:border-zinc-800 rounded-2xl rounded-tl-xs px-3.5 py-2.5 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium ml-1">Analyzing screen metrics & verified data…</span>
                  </div>
                </div>
              )}

              {/* Chat Error Notice */}
              {chatError && (
                <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 dark:text-red-400 dark:bg-red-500/10 dark:border-red-500/20 p-2.5 rounded-xl text-center">
                  {chatError}
                </p>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Quick Prompt Chips */}
            <div className="px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none border-t border-zinc-200/80 bg-zinc-50/80 dark:border-zinc-800 dark:bg-[#0f141f] text-[10px]">
              <button
                type="button"
                disabled={chatLoading || isRecording}
                onClick={() => handleSendTextMessage("Give a simple beginner-friendly verdict on this stock: Is it safe and fundamentally sound?")}
                className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 border border-zinc-200/90 shadow-2xs dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:border-zinc-700 transition-all font-medium disabled:opacity-50 flex items-center gap-1 cursor-pointer"
              >
                <ShieldCheck className="w-2.5 h-2.5 text-emerald-500" /> Simple Verdict
              </button>
              <button
                type="button"
                disabled={chatLoading || isRecording}
                onClick={() => handleSendTextMessage("Explain the P/E ratio and valuation of this stock in simple plain words for a beginner.")}
                className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 border border-zinc-200/90 shadow-2xs dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:border-zinc-700 transition-all font-medium disabled:opacity-50 cursor-pointer"
              >
                💰 P/E in Plain Words
              </button>
              <button
                type="button"
                disabled={chatLoading || isRecording}
                onClick={() => handleSendTextMessage("Explain the Smart Score of this stock and what it means in simple terms.")}
                className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 border border-zinc-200/90 shadow-2xs dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:border-zinc-700 transition-all font-medium disabled:opacity-50 cursor-pointer"
              >
                ⭐ Smart Score Rationale
              </button>
              <button
                type="button"
                disabled={chatLoading || isRecording}
                onClick={() => handleSendTextMessage("What are the biggest risks or red flags in this company that a beginner should know?")}
                className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 border border-zinc-200/90 shadow-2xs dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:border-zinc-700 transition-all font-medium disabled:opacity-50 cursor-pointer"
              >
                ⚠️ Top Risks for Beginners
              </button>
            </div>

            {/* Input Bar with Text & User-Controlled Microphone */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendTextMessage(chatInput);
              }}
              className="flex items-center gap-2 p-2.5 border-t border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-[#0c1017]"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={isRecording ? "Listening to your voice… tap mic to finish" : "Ask in plain words (e.g. Is this stock safe for beginners?)..."}
                disabled={chatLoading || isRecording}
                className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-1 focus:ring-emerald-500 dark:border-zinc-800 dark:bg-[#121722] dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-emerald-500 disabled:opacity-50"
              />

              {/* User-Triggered Microphone Button */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={chatLoading}
                title={isRecording ? "Stop recording and send" : "Speak your question using microphone"}
                className={`p-2.5 rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer flex items-center justify-center ${
                  isRecording
                    ? "bg-red-500 text-white animate-pulse hover:bg-red-600"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                }`}
              >
                {isRecording ? (
                  <Square className="w-3.5 h-3.5 fill-white text-white" />
                ) : (
                  <Mic className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                )}
              </button>

              {/* Send Button */}
              <button
                type="submit"
                disabled={!chatInput.trim() || chatLoading || isRecording}
                title="Send message"
                className="p-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 transition-all shadow-xs active:scale-95 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>

            {/* Footer Notice */}
            <div className="px-3 pb-2 pt-0.5 text-[9.5px] text-zinc-400 dark:text-zinc-500 text-center flex items-center justify-center gap-1 bg-white dark:bg-[#0c1017]">
              <ShieldCheck className="w-3 h-3 text-emerald-500/80" />
              <span>Grounded in live NSE/BSE filings. Educational research only.</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
