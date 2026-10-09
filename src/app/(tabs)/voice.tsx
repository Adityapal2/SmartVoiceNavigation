import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  View,
  Text,
  Alert,
  Linking,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  ActivityIndicator,
  ScrollView,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";

import { askAI, AIResult } from "../../ai/assistant";
import { router } from "expo-router";

import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
import { stopNavigation } from "../../services/navigation";

import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

import { useAudioPlayer } from "expo-audio";

type Status =
  | "idle"
  | "recording"
  | "uploading"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

interface HistoryItem {
  id: string;
  question: string;
  answer: string;
  intent?: string;
}

const COMMAND_CHIPS = [
  { label: "🏥 Hospital", prompt: "Find nearest hospital" },
  { label: "⛽ Petrol", prompt: "Petrol pump nearby" },
  { label: "🏠 Home", prompt: "Navigate Home" },
  { label: "🏢 Work", prompt: "Navigate Work" },
  { label: "🍽 Restaurant", prompt: "Find nearby restaurant" },
  { label: "🏧 ATM", prompt: "Find nearest ATM" },
  { label: "🇮🇳 Hindi Nav", prompt: "Hindi navigation" },
  { label: "🛣 Avoid Toll", prompt: "Avoid toll roads" },
  { label: "🚨 SOS", prompt: "Emergency SOS" },
];

const STATUS_LABEL: Record<Status, string> = {
  idle: "Listening continuous...",
  recording: "Listening...",
  uploading: "Processing Audio...",
  transcribing: "Converting to text...",
  thinking: "AI is thinking...",
  speaking: "Responding...",
  error: "Listening interrupted — retrying...",
};

/* =========================================================
   WAVEFORM
========================================================= */

const WAVE_FRAMES = [
  [8, 18, 12, 26, 10, 22, 14],
  [12, 26, 18, 34, 16, 28, 10],
  [18, 32, 14, 24, 30, 16, 26],
  [10, 24, 34, 16, 28, 20, 12],
];

/* =========================================================
   COMPONENT
========================================================= */

export default function VoiceTab() {
  /* -------------------------------------------------------
     ANIMATIONS
  ------------------------------------------------------- */

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  /* -------------------------------------------------------
     STATE
  ------------------------------------------------------- */

  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [displayedReply, setDisplayedReply] = useState("");
  const [intent, setIntent] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [waveIndex, setWaveIndex] = useState(0);

  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [voiceLanguage, setVoiceLanguage] = useState<
    "English (India)" | "Hindi (India)" | "Hinglish"
  >("Hinglish");
  const [audioUri, setAudioUri] = useState<string | null>(null);

  // Always-On Voice Navigation mode flag
  const [voiceNavigationMode, setVoiceNavigationMode] = useState(true);

  // SOS Confirmation State
  const awaitingSosConfirmationRef = useRef(false);

  const lastRecognizedTextRef = useRef("");
  const voiceNavigationModeRef = useRef(true);
  const recognitionRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionStartingRef = useRef(false);
  const processingCommandRef = useRef(false);
  const networkErrorCountRef = useRef(0);

  /* -------------------------------------------------------
     AUDIO PLAYER (EXPO-AUDIO)
  ------------------------------------------------------- */

  const player = useAudioPlayer(audioUri);

  useEffect(() => {
    voiceNavigationModeRef.current = voiceNavigationMode;
  }, [voiceNavigationMode]);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem("@smart_voice_navigation_settings");
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (typeof saved.voiceSpeed === "number") setVoiceSpeed(Math.min(1.2, Math.max(0.7, saved.voiceSpeed)));
        if (saved.voiceLanguage === "English (India)" || saved.voiceLanguage === "Hindi (India)" || saved.voiceLanguage === "Hinglish") {
          setVoiceLanguage(saved.voiceLanguage);
        }
      } catch (e) {
        console.warn("[VoiceTab] Settings load failed:", e);
      }
    })();
  }, []);

  /* -------------------------------------------------------
     DERIVED STATE
  ------------------------------------------------------- */

  const isRecording = status === "recording";
  const isSpeaking = status === "speaking";
  const isBusy = status !== "idle" && status !== "error" && status !== "recording";

  /* =========================================================
     NO-TOUCH RECOGNITION SESSION & RESTART LOOP
  ========================================================= */

  const scheduleRecognitionRestart = (delay = 350) => {
    if (!voiceNavigationModeRef.current) return;

    if (recognitionRestartTimerRef.current) {
      clearTimeout(recognitionRestartTimerRef.current);
    }

    recognitionRestartTimerRef.current = setTimeout(() => {
      recognitionRestartTimerRef.current = null;
      if (voiceNavigationModeRef.current && !recognitionStartingRef.current && !processingCommandRef.current) {
        void startRecognitionSession();
      }
    }, delay);
  };

  const startRecognitionSession = async () => {
    if (recognitionStartingRef.current) return;
    if (!voiceNavigationModeRef.current) return;
    if (processingCommandRef.current) return;

    try {
      recognitionStartingRef.current = true;

      const available = await ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!available) {
        console.warn("[VoiceTab] Speech recognition is unavailable.");
        return;
      }

      setStatus("recording");

      ExpoSpeechRecognitionModule.start({
        lang: voiceLanguage === "Hindi (India)" ? "hi-IN" : "en-IN",
        interimResults: false,
        continuous: false,
        androidIntentOptions: {
          EXTRA_LANGUAGE_MODEL: "free_form",
        },
      });

      console.log("[VoiceTab] Continuous recognition loop session active.");
    } catch (error) {
      console.error("[VoiceTab] Recognition session error:", error);
      processingCommandRef.current = false;
      scheduleRecognitionRestart(1000);
    } finally {
      recognitionStartingRef.current = false;
    }
  };

  /* =========================================================
     NATIVE SPEECH RECOGNITION EVENTS
  ========================================================= */

  useSpeechRecognitionEvent("start", () => {
    console.log("[VoiceTab] Native speech recognition started");
    setStatus("recording");
  });

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results?.[0]?.transcript?.trim() || "";
    if (!text) return;

    setTranscript(text);

    if (event.isFinal) {
      if (text.toLowerCase() === lastRecognizedTextRef.current.toLowerCase()) {
        return;
      }

      lastRecognizedTextRef.current = text;
      networkErrorCountRef.current = 0;
      processingCommandRef.current = true;

      console.log("[VoiceTab] Native transcript:", text);
      void processAI(text);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    const errorCode = String(event.error ?? "").toLowerCase();
    const errorMessage = String(event.message ?? "");

    console.log("[VoiceTab] Speech event code:", errorCode, errorMessage);

    if (
      errorCode === "no-speech" ||
      errorCode === "speech-timeout" ||
      errorCode === "aborted" ||
      errorCode === "cancelled" ||
      errorCode === "canceled" ||
      errorCode.includes("no_speech")
    ) {
      setStatus("idle");
      if (voiceNavigationModeRef.current && !processingCommandRef.current) {
        scheduleRecognitionRestart(300);
      }
      return;
    }

    if (errorCode === "network") {
      networkErrorCountRef.current += 1;
      if (networkErrorCountRef.current <= 5) {
        setStatus("idle");
        if (voiceNavigationModeRef.current && !processingCommandRef.current) {
          scheduleRecognitionRestart(networkErrorCountRef.current * 1000);
        }
        return;
      }
    }

    setStatus("idle");
    processingCommandRef.current = false;
    if (voiceNavigationModeRef.current) {
      scheduleRecognitionRestart(1000);
    }
  });

  useSpeechRecognitionEvent("end", () => {
    console.log("[VoiceTab] Native speech recognition ended");

    if (processingCommandRef.current) {
      return;
    }

    if (voiceNavigationModeRef.current) {
      scheduleRecognitionRestart(400);
    } else {
      setStatus("idle");
    }
  });

  /* =========================================================
     AUTO BOOT ALWAYS-ON MODE
  ========================================================= */

  useEffect(() => {
    let cancelled = false;

    const bootAlwaysOnVoice = async () => {
      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (cancelled) return;

        if (!permission.granted) {
          setStatus("error");
          setReply("Microphone permission is required for voice navigation.");
          return;
        }

        const available = await ExpoSpeechRecognitionModule.isRecognitionAvailable();
        if (cancelled) return;

        if (!available) {
          setStatus("error");
          setReply("Speech recognition is unavailable on this device.");
          return;
        }

        voiceNavigationModeRef.current = true;
        setVoiceNavigationMode(true);
        console.log("[VoiceTab] Always-On voice mode initialized.");
        scheduleRecognitionRestart(200);
      } catch (error) {
        console.error("[VoiceTab] Always-On boot error:", error);
      }
    };

    void bootAlwaysOnVoice();

    return () => {
      cancelled = true;
      voiceNavigationModeRef.current = false;
      if (recognitionRestartTimerRef.current) {
        clearTimeout(recognitionRestartTimerRef.current);
      }
      Speech.stop();
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch (_) { }
    };
  }, []);

  /* =========================================================
     AUDIO / TTS CONTROL
  ========================================================= */

  const stopAudioAndSpeech = async () => {
    try {
      await Speech.stop();
      if (player && player.playing) {
        player.pause();
      }
    } catch (e) {
      console.warn("[VoiceTab] Error stopping audio/speech:", e);
    }
  };

  /* =========================================================
     ANIMATIONS
  ========================================================= */

  useEffect(() => {
    if (isRecording || isBusy) {
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 800,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.95,
            duration: 800,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
        ])
      );

      const rotateLoop = Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 2500,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );

      pulseLoop.start();
      rotateLoop.start();

      return () => {
        pulseLoop.stop();
        rotateLoop.stop();
      };
    }

    Animated.timing(pulseAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    rotateAnim.setValue(0);
  }, [isRecording, isBusy, pulseAnim, rotateAnim]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  useEffect(() => {
    if (!isRecording) {
      setWaveIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setWaveIndex((prev) => (prev + 1) % WAVE_FRAMES.length);
    }, 200);

    return () => clearInterval(interval);
  }, [isRecording]);

  /* =========================================================
     TYPING EFFECT
  ========================================================= */

  useEffect(() => {
    if (!reply) {
      setDisplayedReply("");
      return;
    }

    let currentIndex = 0;
    setDisplayedReply("");

    const typingInterval = setInterval(() => {
      if (currentIndex < reply.length) {
        setDisplayedReply(reply.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(typingInterval);
      }
    }, 20);

    return () => clearInterval(typingInterval);
  }, [reply]);

  /* =========================================================
     TEXT CLEANER & SPEECH UTILS
  ========================================================= */

  const cleanTextForSpeech = (rawText: string): string => {
    return rawText
      .replace(/[\*#\_\~\`>-]/g, "")
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  const getSpeechLanguage = (text: string): string => {
    if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
    return voiceLanguage === "Hindi (India)" ? "hi-IN" : "en-IN";
  };

  const speakServiceReply = (message: string) => {
    setReply(message);
    setStatus("speaking");
    Speech.speak(cleanTextForSpeech(message), {
      language: getSpeechLanguage(message),
      rate: voiceSpeed,
      onDone: () => {
        processingCommandRef.current = false;
        setStatus("idle");
        scheduleRecognitionRestart(300);
      },
      onStopped: () => {
        processingCommandRef.current = false;
        setStatus("idle");
        scheduleRecognitionRestart(300);
      },
      onError: () => {
        processingCommandRef.current = false;
        setStatus("idle");
        scheduleRecognitionRestart(300);
      },
    });
  };

  /* =========================================================
     MAP / NAVIGATION ACTION HELPERS
  ========================================================= */

  const goToMapNavigation = (destination: string) => {
    const place = destination.trim();
    if (!place) return;

    router.push({
      pathname: "/(tabs)/map",
      params: {
        destination: place,
        autoStart: "true",
      },
    });
  };

  const normalizeVoiceCommand = (input: string): string => {
    let value = input
      .normalize("NFC")
      .replace(/[।！？]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const prefixRules: Array<[RegExp, string]> = [
      [/^गेट\s+डायरेक्शन\s+टू\s+/i, "navigate to "],
      [/^गेट\s+डायरेक्शन\s+/i, "navigate to "],
      [/^डायरेक्शन\s+टू\s+/i, "navigate to "],
      [/^नेविगेट\s+टू\s+/i, "navigate to "],
      [/^नेविगेट\s+/i, "navigate to "],
      [/^जाओ\s+/i, "go to "],
      [/^जाना\s+है\s+/i, "go to "],
    ];

    for (const [pattern, replacement] of prefixRules) {
      if (pattern.test(value)) {
        value = value.replace(pattern, replacement);
        break;
      }
    }

    return value.trim();
  };

  const parseLocalNavigationCommand = (input: string): AIResult => {
    const original = input.normalize("NFC").trim();
    const normalized = normalizeVoiceCommand(original);

    const text = normalized.toLowerCase().replace(/[।,!?]+$/g, "").replace(/\s+/g, " ").trim();
    const originalLower = original.toLowerCase().replace(/[।,!?]+$/g, "").replace(/\s+/g, " ").trim();

    const general: AIResult = {
      reply: "",
      intent: "general",
      destination: "",
      category: "",
    };

    if (!text) return general;

    const cleanDestination = (value: string): string =>
      value.trim().replace(/^[\s,.-]+/, "").replace(/[\s,.!?।]+$/g, "").trim();

    const isSpecialDestination = (value: string): boolean =>
      /^(home|work|office|nearby|near me|nearest|घर|काम|ऑफिस|पास|पास में|नज़दीक|नजदीक|नजदीकी)$/i.test(value.trim());

    // Check emergency / help / sos keywords
    if (
      /emergency|sos|help|help me|मदद|बचाओ|आपातकाल/i.test(originalLower) ||
      /help/i.test(text)
    ) {
      return {
        ...general,
        reply: "Emergency confirmation required. Should I send your live location and call your emergency contact? Say yes or no.",
        intent: "emergency_prompt",
      };
    }

    // Navigation Controls
    if (/\b(resume|continue|start again)\b.*\b(navigation|route)\b/i.test(original) || /resume navigation/i.test(originalLower)) {
      return { ...general, reply: "Resuming navigation.", intent: "resume_navigation" };
    }

    if (/\b(pause|hold|wait)\b.*\b(navigation|route)\b/i.test(original) || /pause route/i.test(originalLower)) {
      return { ...general, reply: "Pausing navigation.", intent: "pause_navigation" };
    }

    if (/alternative route|different route|दूसरा रास्ता/i.test(original)) {
      return { ...general, reply: "Looking for an alternative route.", intent: "alternative_route" };
    }

    if (/avoid traffic|ट्रैफिक से बचो/i.test(original)) {
      return { ...general, reply: "Looking for a lower-traffic route.", intent: "avoid_traffic" };
    }

    if (/reroute|फिर से route|नया रास्ता/i.test(original)) {
      return { ...general, reply: "Recalculating your route.", intent: "reroute" };
    }

    // Stop Navigation
    const stopNavigationPatterns = [
      "stop navigation", "cancel navigation", "navigation band", "navigation bandh",
      "navigation band karo", "navigation rok do", "navigation roko", "stop route",
      "रास्ता बंद करो", "नेविगेशन बंद करो", "नेविगेशन रोको", "रूट बंद करो"
    ];

    if (stopNavigationPatterns.some((phrase) => originalLower.includes(phrase) || text.includes(phrase))) {
      return { ...general, reply: "Navigation cancelled.", intent: "cancel_navigation" };
    }

    // Home / Work
    if (/\b(go|take me|navigate|start|drive|route)\s+(to\s+)?home\b/i.test(original) || /घर चलो|ghar chalo/i.test(original)) {
      return { ...general, reply: "Opening the route to Home.", intent: "navigate_home" };
    }

    if (/\b(go|take me|navigate|start|drive|route)\s+(to\s+)?(work|office)\b/i.test(original) || /ऑफिस चलो|office chalo/i.test(original)) {
      return { ...general, reply: "Opening the route to Work.", intent: "navigate_work" };
    }

    // Nearby Places
    const nearbyList: Array<[string, RegExp[]]> = [
      ["hospital", [/\b(hospital|hospitals|aspataal|aspatal)\b/i, /अस्पताल|हॉस्पिटल/i]],
      ["petrol pump", [/\b(petrol pump|petrol|fuel|gas station)\b/i, /पेट्रोल पंप|पेट्रोल/i]],
      ["restaurant", [/\b(restaurant|restaurants|food|eatery)\b/i, /रेस्टोरेंट|रेस्तरां|खाना/i]],
      ["ATM", [/\b(atm|cash machine)\b/i, /एटीएम/i]],
      ["police", [/\b(police|police station)\b/i, /पुलिस|थाना/i]],
    ];

    const nearbyWords = ["near", "nearby", "nearest", "near me", "paas", "nazdeek", "najdik", "ढूंढो", "पास"];

    for (const [category, patterns] of nearbyList) {
      const hasCategory = patterns.some((pattern) => pattern.test(original) || pattern.test(normalized));
      const hasNearbyWord = nearbyWords.some((word) => originalLower.includes(word) || text.includes(word));

      if (hasCategory && hasNearbyWord) {
        return {
          ...general,
          reply: `Finding the nearest ${category}.`,
          intent: "nearby_search",
          category,
        };
      }
    }

    // Settings / Avoids
    if (/avoid\s+(toll|tolls)|toll.*avoid|टोल.*बच/i.test(text)) {
      return { ...general, reply: "I will avoid toll roads.", intent: "avoid_tolls" };
    }

    // Direct Navigation
    const directNavigationPatterns = [
      /^(?:please\s+)?(?:start\s+)?(?:navigation|navigate|go|take me|drive|route)\s+(?:to\s+)?(.+)$/i,
      /^(?:please\s+)?get\s+(?:the\s+)?directions?\s+to\s+(.+)$/i,
      /^(?:please\s+)?navigate\s+to\s+(.+)$/i,
      /^गेट\s+डायरेक्शन\s+टू\s+(.+)$/i,
      /^नेविगेट\s+टू\s+(.+)$/i,
      /^रास्ता\s+बताओ\s+(.+)$/i,
    ];

    for (const pattern of directNavigationPatterns) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;

      const destination = cleanDestination(match[1]);
      if (destination && !isSpecialDestination(destination)) {
        const isHindi = /[\u0900-\u097F]/.test(destination);
        return {
          ...general,
          reply: isHindi ? `${destination} के लिए रास्ता खोल रहा हूँ।` : `Opening the route to ${destination}.`,
          intent: "navigate",
          destination,
        };
      }
    }

    // Hinglish patterns
    let match = original.match(/^(?:mujhe|mujhko)\s+(.+?)\s+(?:le chalo|le jao|jana hai)$/i) ||
      original.match(/^(.+?)\s+(?:chalo|jao|jana hai|le chalo|le jao)$/i);

    if (match?.[1]) {
      const destination = cleanDestination(match[1]);
      if (destination && !isSpecialDestination(destination)) {
        return {
          ...general,
          reply: `Opening the route to ${destination}.`,
          intent: "navigate",
          destination,
        };
      }
    }

    // Weather commands
    const weatherPatterns = [
      /\b(weather|temperature|humidity|forecast)\b/i,
      /\b(check|tell|what is|how is|show|get).{0,35}\b(weather|temperature|humidity)\b/i,
      /\b(how hot|how cold|is it raining|will it rain|weather batao|mausam batao|mausam kaisa|temperature kitna)\b/i,
      /मौसम|तापमान|बारिश|बरसात|कितनी गर्मी|ठंड कैसी/i,
      /\b(mausam|tapman|taapman|barish|baarish)\b/i,
    ];
    if (weatherPatterns.some((pattern) => pattern.test(original) || pattern.test(normalized))) {
      const hindi = /[\u0900-\u097F]/.test(original) || voiceLanguage === "Hindi (India)";
      return { ...general, reply: hindi ? "आपकी जगह का मौसम चेक कर रहा हूँ।" : "Checking the weather at your location.", intent: "weather" };
    }

    return general;
  };

  /* =========================================================
     EXECUTE EMERGENCY SOS (SMS + WHATSAPP + CALL)
  ========================================================= */

  const executeEmergencySOS = async () => {
    const user = auth.currentUser;

    if (!user) {
      speakServiceReply("Please sign in before using emergency SOS.");
      return;
    }

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.exists() ? snap.data() : {};
      const rawContacts = Array.isArray(data?.emergencyContacts)
        ? data.emergencyContacts
        : data?.emergencyContact
          ? [data.emergencyContact]
          : [];

      const contacts = rawContacts.filter((contact: any) => contact?.phone);

      if (contacts.length === 0) {
        speakServiceReply("Please add an emergency contact in settings first.");
        return;
      }

      const contact = contacts[0];
      let locationText = "GPS location is currently unavailable.";

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          locationText = `https://www.google.com/maps/search/?api=1&query=${location.coords.latitude},${location.coords.longitude}`;
        }
      } catch (error) {
        console.warn("[VoiceTab][SOS] Location error:", error);
      }

      const body = [
        "🚨 EMERGENCY ALERT",
        "I need help! Here is my live location:",
        locationText,
      ].join("\n");

      // 1. Send SMS
      const smsUrl = `sms:${contact.phone}?body=${encodeURIComponent(body)}`;
      try {
        if (await Linking.canOpenURL(smsUrl)) {
          await Linking.openURL(smsUrl);
        }
      } catch (error) {
        console.error("[VoiceTab][SOS] SMS error:", error);
      }

      // 2. Send WhatsApp Message
      const waPhone = contact.phone.replace(/\D/g, "");
      const waUrl = `whatsapp://send?phone=${waPhone}&text=${encodeURIComponent(body)}`;
      try {
        if (await Linking.canOpenURL(waUrl)) {
          await Linking.openURL(waUrl);
        }
      } catch (error) {
        console.error("[VoiceTab][SOS] WhatsApp error:", error);
      }

      // 3. Trigger Emergency Call
      const telUrl = `tel:${contact.phone}`;
      try {
        if (await Linking.canOpenURL(telUrl)) {
          await Linking.openURL(telUrl);
        }
      } catch (error) {
        console.error("[VoiceTab][SOS] Call error:", error);
      }

      speakServiceReply(`Sending emergency alert and calling ${contact.name || "emergency contact"}.`);
    } catch (error) {
      console.error("[VoiceTab][SOS] Error:", error);
      speakServiceReply("Unable to complete emergency action.");
    }
  };

  /* =========================================================
     INTENT HANDLERS
  ========================================================= */

  const handleWeatherIntent = async () => {
    try {
      setStatus("thinking");
      setReply(voiceLanguage === "Hindi (India)" ? "मौसम की जानकारी ला रहा हूँ…" : "Getting current weather…");
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        speakServiceReply(voiceLanguage === "Hindi (India)" ? "आपके स्थान का मौसम बताने के लिए लोकेशन की अनुमति ज़रूरी है।" : "Location permission is required to check your local weather.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`);
      if (!response.ok) throw new Error("Weather request failed");
      const data = await response.json();
      const current = data?.current;
      if (!current) throw new Error("Weather data missing");
      const descriptions: Record<number, string> = { 0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "foggy", 48: "foggy", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "moderate rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers", 81: "moderate rain showers", 82: "heavy rain showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "heavy thunderstorm with hail" };
      const condition = descriptions[Number(current.weather_code)] || "changeable conditions";
      const temperature = Math.round(Number(current.temperature_2m));
      const feelsLike = Math.round(Number(current.apparent_temperature));
      const humidity = Math.round(Number(current.relative_humidity_2m));
      const wind = Math.round(Number(current.wind_speed_10m));
      const hindi = voiceLanguage === "Hindi (India)";
      const message = hindi ? `अभी मौसम ${condition} है। तापमान ${temperature} डिग्री सेल्सियस है, महसूस ${feelsLike} डिग्री जैसा हो रहा है। नमी ${humidity} प्रतिशत और हवा की रफ्तार ${wind} किलोमीटर प्रति घंटा है।` : `Current weather: ${condition}. Temperature is ${temperature} degrees Celsius, feels like ${feelsLike} degrees. Humidity is ${humidity} percent and wind speed is ${wind} kilometers per hour.`;
      setIntent("weather");
      setReply(message);
      try { await saveVoiceHistory("Check current weather", message, "weather"); } catch (historyError) { console.warn("Could not save weather voice history:", historyError); }
      speakServiceReply(message);
    } catch (error) {
      console.warn("Weather lookup failed:", error);
      speakServiceReply(voiceLanguage === "Hindi (India)" ? "अभी मौसम की जानकारी नहीं मिल पाई। कृपया थोड़ी देर बाद कोशिश करें।" : "I could not get the current weather right now. Please try again shortly.");
    }
  };

  const handleCallIntent = async (nameQuery: string) => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        speakServiceReply("Please sign in before using voice calling.");
        return;
      }

      const snapshot = await getDoc(doc(db, "users", currentUser.uid));
      const data = snapshot.exists() ? snapshot.data() : {};
      const contacts = Array.isArray(data?.emergencyContacts) ? data.emergencyContacts : [];

      const query = nameQuery.trim().toLowerCase();
      const contact = contacts.find((item: any) =>
        String(item?.name || "").toLowerCase().includes(query)
      );

      if (!contact?.phone) {
        speakServiceReply(`I could not find a contact named ${nameQuery}.`);
        return;
      }

      Alert.alert("Voice Call", `Call ${contact.name || nameQuery}?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Call",
          onPress: async () => {
            const telUrl = `tel:${contact.phone}`;
            if (await Linking.canOpenURL(telUrl)) await Linking.openURL(telUrl);
          },
        },
      ]);
      speakServiceReply(`Preparing call to ${contact.name || nameQuery}.`);
    } catch (error) {
      speakServiceReply("I could not access your contacts right now.");
    }
  };

  const saveVoiceHistory = async (question: string, answer: string, commandIntent?: string, destination?: string, category?: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      await addDoc(collection(db, "users", currentUser.uid, "history"), {
        title: destination || category || question,
        subtitle: commandIntent === "navigate" ? "Voice navigation" : "Voice command",
        destination: destination || "",
        category: category || "",
        type: commandIntent === "navigate" ? "route" : "search",
        question,
        answer,
        intent: commandIntent || "general",
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn("[VoiceTab] History save failed:", error);
    }
  };

  /* =========================================================
     PROCESS AI COMMAND MAIN
  ========================================================= */

  const processAI = async (text: string) => {
    if (!text?.trim()) {
      processingCommandRef.current = false;
      setStatus("idle");
      scheduleRecognitionRestart(200);
      return;
    }

    try {
      await stopAudioAndSpeech();
      setTranscript(text);

      // Handle SOS Confirmation Loop
      if (awaitingSosConfirmationRef.current) {
        const lowerText = text.toLowerCase();
        awaitingSosConfirmationRef.current = false;

        if (
          lowerText.includes("yes") ||
          lowerText.includes("haan") ||
          lowerText.includes("ha") ||
          lowerText.includes("sahi") ||
          lowerText.includes("confirm") ||
          lowerText.includes("हाँ")
        ) {
          await executeEmergencySOS();
          return;
        } else {
          speakServiceReply("Emergency alert cancelled.");
          return;
        }
      }

      const normalizedText = normalizeVoiceCommand(text);
      let localResult = parseLocalNavigationCommand(text);

      if (localResult.intent === "general" && normalizedText !== text) {
        localResult = parseLocalNavigationCommand(normalizedText);
      }

      if (localResult.intent !== "general") {
        if (localResult.intent === "weather") {
          setIntent("weather");
          await handleWeatherIntent();
          return;
        }

        setIntent(localResult.intent);
        setReply(localResult.reply);

        if (localResult.intent === "emergency_prompt") {
          awaitingSosConfirmationRef.current = true;
          speakServiceReply(localResult.reply);
          return;
        }

        setStatus("speaking");

        Speech.speak(cleanTextForSpeech(localResult.reply), {
          language: getSpeechLanguage(localResult.reply),
          rate: voiceSpeed,
          onDone: () => {
            processingCommandRef.current = false;
            setStatus("idle");
            scheduleRecognitionRestart(300);
          },
          onStopped: () => {
            processingCommandRef.current = false;
            setStatus("idle");
            scheduleRecognitionRestart(300);
          },
          onError: () => {
            processingCommandRef.current = false;
            setStatus("idle");
            scheduleRecognitionRestart(300);
          },
        });

        switch (localResult.intent) {
          case "navigate":
            if (localResult.destination) goToMapNavigation(localResult.destination);
            break;
          case "nearby_search":
            if (localResult.category) goToMapNavigation(localResult.category);
            break;
          case "navigate_home":
            goToMapNavigation("Home");
            break;
          case "navigate_work":
            goToMapNavigation("Work");
            break;
          case "cancel_navigation":
            await stopNavigation();
            break;
          case "pause_navigation":
          case "resume_navigation":
          case "alternative_route":
          case "avoid_traffic":
          case "reroute":
          case "avoid_tolls":
            router.push({ pathname: "/(tabs)/map", params: { navigationAction: localResult.intent } });
            break;
          case "weather":
            await handleWeatherIntent();
            break;
          case "call":
            if (localResult.destination) await handleCallIntent(localResult.destination);
            break;
        }

        setHistory((previous) => [
          { id: Date.now().toString(), question: text, answer: localResult.reply, intent: localResult.intent },
          ...previous,
        ]);

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }

      setStatus("thinking");
      const result: AIResult = await askAI(text);

      if (!result || !result.reply) {
        throw new Error("AI returned empty response.");
      }

      setIntent(result.intent ?? null);
      setReply(result.reply);
      setStatus("speaking");

      const audioUrl = (result as any)?.audioUrl || (result as any)?.audio;

      if (audioUrl) {
        setAudioUri(audioUrl);
        player.replace({ uri: audioUrl });
        player.play();
        processingCommandRef.current = false;
        scheduleRecognitionRestart(800);
      } else {
        const cleanedReply = cleanTextForSpeech(result.reply);
        const spokenText = cleanedReply.length > 300 ? cleanedReply.slice(0, 300) + "..." : cleanedReply;

        Speech.speak(spokenText, {
          language: getSpeechLanguage(spokenText),
          pitch: 1,
          rate: voiceSpeed,
          onDone: () => {
            processingCommandRef.current = false;
            setStatus("idle");
            scheduleRecognitionRestart(300);
          },
          onStopped: () => {
            processingCommandRef.current = false;
            setStatus("idle");
            scheduleRecognitionRestart(300);
          },
          onError: () => {
            processingCommandRef.current = false;
            setStatus("idle");
            scheduleRecognitionRestart(500);
          },
        });
      }

      if (result.intent === "navigate" && result.destination) {
        goToMapNavigation(result.destination);
      } else if (result.intent === "nearby_search" && result.category) {
        goToMapNavigation(result.category);
      }

      await saveVoiceHistory(text, result.reply, result.intent, result.destination, result.category);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error("[VoiceTab] AI processing Error:", error);
      await stopAudioAndSpeech();
      const errorMessage = "Sorry, I couldn't process that request.";
      setReply(errorMessage);
      setStatus("error");

      Speech.speak(errorMessage, {
        onDone: () => {
          processingCommandRef.current = false;
          setStatus("idle");
          scheduleRecognitionRestart(500);
        },
      });
    }
  };

  const handleChipPress = async (prompt: string) => {
    if (isBusy) return;
    setTranscript(prompt);
    await processAI(prompt);
  };

  const wave = WAVE_FRAMES[waveIndex];

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <LinearGradient colors={["#050505", "#0B0B12", "#030305"]} style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* HEADER */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Smart Voice</Text>
              <Text style={styles.subtitle}>Always-On AI Navigation</Text>
            </View>
            <View style={styles.statusDot} />
          </View>

          {/* STATUS */}
          <View style={styles.statusContainer}>
            {status === "thinking" || status === "transcribing" || status === "uploading" ? (
              <ActivityIndicator size="small" color="#8B5CF6" />
            ) : null}
            <Text style={styles.statusText}>{STATUS_LABEL[status]}</Text>
          </View>

          {/* SIRI ORB */}
          <View style={styles.orbArea}>
            <Animated.View style={[styles.glowOuter, { transform: [{ scale: pulseAnim }] }]} />
            <Animated.View style={[styles.rotatingRing, { transform: [{ rotate: spin }] }]} />
            <View style={styles.orbButton}>
              <LinearGradient
                colors={["#6C5CE7", "#8B5CF6", "#EC4899"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.orbGradient}
              >
                <Ionicons
                  name={isSpeaking ? "volume-high" : isRecording ? "mic" : "mic-outline"}
                  size={42}
                  color="#FFFFFF"
                />
              </LinearGradient>
            </View>
          </View>

          {/* WAVEFORM */}
          {isRecording && (
            <View style={styles.waveContainer}>
              {wave.map((height, index) => (
                <View key={index} style={[styles.waveBar, { height }]} />
              ))}
            </View>
          )}

          {/* TRANSCRIPT */}
          {transcript ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="person" size={18} color="#8B5CF6" />
                <Text style={styles.cardTitle}>YOU SAID</Text>
              </View>
              <Text style={styles.transcriptText}>{transcript}</Text>
            </View>
          ) : null}

          {/* AI REPLY */}
          {reply ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="sparkles" size={18} color="#EC4899" />
                <Text style={styles.cardTitle}>AI REPLY</Text>
              </View>
              <Text style={styles.replyText}>{displayedReply}</Text>
              {intent ? (
                <View style={styles.intentBadge}>
                  <Text style={styles.intentText}>{intent}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* QUICK COMMANDS */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Commands</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipContainer}
            >
              {COMMAND_CHIPS.map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={styles.chip}
                  disabled={isBusy}
                  onPress={() => handleChipPress(item.prompt)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.chipText}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* HISTORY */}
          {history.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent Conversations</Text>
              {history.slice(0, 5).map((item) => (
                <View key={item.id} style={styles.historyCard}>
                  <Text style={styles.historyQuestion}>{item.question}</Text>
                  <Text style={styles.historyAnswer} numberOfLines={3}>
                    {item.answer}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* FOOTER */}
          <View style={styles.footer}>
            <Ionicons name="shield-checkmark" size={15} color="#777" />
            <Text style={styles.footerText}>Always-On Continuous Listener Active</Text>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

/* =========================================================
   STYLES
========================================================= */

/* =========================================================
   DESIGN TOKENS
========================================================= */

const COLORS = {
  // Backgrounds
  bg: "#050505",

  // Text
  textPrimary: "#FFFFFF",
  textSecondary: "#E4E4E7",
  textMuted: "#A1A1AA",
  textSubtle: "#8E8E99",
  textFaint: "#666",

  // Brand
  purple: "#8B5CF6",
  purpleLight: "#A78BFA",
  purpleGlow: "rgba(139,92,246,0.15)",
  purpleSoft: "rgba(139,92,246,0.18)",
  purpleStrong: "rgba(139,92,246,0.9)",
  pinkRing: "rgba(236,72,153,0.45)",

  // Status
  online: "#34D399",

  // Surfaces
  surfaceCard: "rgba(255,255,255,0.06)",
  surfaceChip: "rgba(255,255,255,0.07)",
  surfaceHistory: "rgba(255,255,255,0.04)",

  // Borders
  borderCard: "rgba(255,255,255,0.10)",
  borderHistory: "rgba(255,255,255,0.07)",
};

/* =========================================================
   STYLES
========================================================= */

const styles = StyleSheet.create({
  /* ---------- LAYOUT ---------- */
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  section: { marginTop: 28 },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 12,
  },

  /* ---------- HEADER ---------- */
  header: {
    marginTop: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: COLORS.textPrimary, fontSize: 28, fontWeight: "800" },
  subtitle: { color: COLORS.textSubtle, fontSize: 13, marginTop: 4 },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.online,
  },

  /* ---------- STATUS ---------- */
  statusContainer: {
    marginTop: 22,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  statusText: { color: COLORS.textMuted, fontSize: 14, fontWeight: "600" },

  /* ---------- ORB ---------- */
  orbArea: {
    height: 300,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
  },
  glowOuter: {
    position: "absolute",
    width: 205,
    height: 205,
    borderRadius: 103,
    backgroundColor: COLORS.purpleGlow,
  },
  rotatingRing: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 2,
    borderColor: COLORS.pinkRing,
    borderTopColor: COLORS.purpleStrong,
  },
  orbButton: {
    width: 145,
    height: 145,
    borderRadius: 73,
    overflow: "hidden",
    elevation: 20,
  },
  orbGradient: { flex: 1, alignItems: "center", justifyContent: "center" },

  /* ---------- WAVEFORM ---------- */
  waveContainer: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: -15,
    marginBottom: 15,
  },
  waveBar: { width: 5, borderRadius: 5, backgroundColor: COLORS.purple },

  /* ---------- CARDS (TRANSCRIPT + AI REPLY) ---------- */
  card: {
    backgroundColor: COLORS.surfaceCard,
    borderWidth: 1,
    borderColor: COLORS.borderCard,
    borderRadius: 22,
    padding: 18,
    marginTop: 15,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  transcriptText: { color: COLORS.textPrimary, fontSize: 16, lineHeight: 24 },
  replyText: { color: COLORS.textSecondary, fontSize: 16, lineHeight: 25 },

  /* ---------- INTENT BADGE ---------- */
  intentBadge: {
    alignSelf: "flex-start",
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: COLORS.purpleSoft,
  },
  intentText: { color: COLORS.purpleLight, fontSize: 11, fontWeight: "700" },

  /* ---------- QUICK COMMAND CHIPS ---------- */
  chipContainer: { gap: 10, paddingRight: 10 },
  chip: {
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceChip,
    borderWidth: 1,
    borderColor: COLORS.borderCard,
  },
  chipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: "600" },

  /* ---------- HISTORY ---------- */
  historyCard: {
    backgroundColor: COLORS.surfaceHistory,
    borderWidth: 1,
    borderColor: COLORS.borderHistory,
    borderRadius: 18,
    padding: 15,
    marginBottom: 10,
  },
  historyQuestion: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 7,
  },
  historyAnswer: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20 },

  /* ---------- FOOTER ---------- */
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 30,
  },
  footerText: { color: COLORS.textFaint, fontSize: 11 },
});