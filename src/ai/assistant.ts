// ============================================================
// Smart Voice Navigation - AI Assistant
// ============================================================

export interface AIResult {
  reply: string;
  intent: string;
  destination?: string;
  category?: string;
}

type CommandLanguage =
  | "english"
  | "hindi"
  | "hinglish";

// ============================================================
// NORMALIZE
// ============================================================

const normalize = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ");
};

// ============================================================
// LANGUAGE DETECTION
// ============================================================

const detectLanguage = (
  text: string
): CommandLanguage => {
  const value = text.trim();

  if (!value) {
    return "english";
  }

  // Hindi / Devanagari
  const hindiChars =
    (value.match(/[\u0900-\u097F]/g) || []).length;

  const totalChars =
    value.replace(/\s/g, "").length;

  if (
    totalChars > 0 &&
    hindiChars / totalChars >= 0.35
  ) {
    return "hindi";
  }

  // Hinglish
  const lower = value.toLowerCase();

  const hinglishWords = [
    "mujhe",
    "mujhko",
    "mujhse",
    "jana",
    "jaana",
    "jane",
    "jao",
    "jaye",
    "jaaye",
    "jana hai",
    "jaana hai",
    "rasta",
    "raasta",
    "batao",
    "bataiye",
    "batana",
    "lagao",
    "lagaiye",
    "dikhao",
    "dikhaiye",
    "le chalo",
    "le jao",
    "pahucha",
    "pahuncha",
    "paas",
    "pas",
    "mein",
    "mere",
    "meri",
    "ghar",
    "office",
    "dhundho",
    "dhundo",
    "karo",
    "kar do",
    "hai",
    "ho",
    "ka",
    "ki",
    "ke",
    "chalo",
    "please",
  ];

  const score = hinglishWords.filter(
    (word) =>
      lower.includes(word)
  ).length;

  if (score > 0) {
    return "hinglish";
  }

  return "english";
};

// ============================================================
// LANGUAGE-AWARE REPLY
// ============================================================

const replyByLanguage = (
  language: CommandLanguage,
  english: string,
  hindi: string,
  hinglish: string
): string => {
  if (language === "hindi") {
    return hindi;
  }

  if (language === "hinglish") {
    return hinglish;
  }

  return english;
};

// ============================================================
// CLEAN DESTINATION
// ============================================================

const cleanDestination = (
  value: string
): string => {
  let destination = value.trim();

  // English filler at beginning
  destination = destination.replace(
    /^(?:please|pls|plz|mujhe|mujhko|bhai|yaar|sir|madam)\s+/i,
    ""
  );

  // Hindi filler at beginning
  destination = destination.replace(
    /^(?:मुझे|मुझको|भाई|यार|सर|मैडम)\s+/u,
    ""
  );

  // Remove punctuation
  destination = destination
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .trim();

  // English ending fillers
  destination = destination.replace(
    /\s+(?:please|pls|plz|batao|bataiye|batana)$/i,
    ""
  );

  // Hinglish navigation endings
  destination = destination.replace(
    /\s+(?:jana|jaana|jane|jao|jaye|jaaye|jana hai|jaana hai)$/i,
    ""
  );

  // Hindi navigation endings
  destination = destination.replace(
    /\s+(?:जाना|जाने|जाओ|जाएं|जाये|जाना है)$/u,
    ""
  );

  return destination.trim();
};

// ============================================================
// HOME
// ============================================================

const isHomeCommand = (
  text: string
): boolean => {
  const patterns = [
    "home",
    "go home",
    "take me home",
    "navigate home",
    "open home",

    "ghar",
    "ghar jana",
    "ghar jaana",
    "ghar jana hai",
    "ghar jaana hai",
    "ghar chalo",
    "ghar le chalo",
    "ghar le jao",

    "घर",
    "घर जाना",
    "घर जाना है",
    "घर चलो",
    "घर ले चलो",
    "घर ले जाओ",
    "मुझे घर जाना है",
  ];

  return patterns.some(
    (pattern) =>
      text === pattern ||
      text.includes(pattern)
  );
};

// ============================================================
// WORK
// ============================================================

const isWorkCommand = (
  text: string
): boolean => {
  const patterns = [
    "work",
    "go to work",
    "take me to work",
    "navigate to work",
    "open work",

    "office",
    "office jana",
    "office jaana",
    "office jana hai",
    "office jaana hai",
    "office chalo",
    "office le chalo",
    "office le jao",

    "ऑफिस",
    "ऑफिस जाना",
    "ऑफिस जाना है",
    "ऑफिस चलो",
    "ऑफिस ले चलो",
    "मुझे ऑफिस जाना है",
  ];

  return patterns.some(
    (pattern) =>
      text === pattern ||
      text.includes(pattern)
  );
};

// ============================================================
// CANCEL NAVIGATION
// ============================================================

const isCancelNavigation = (
  text: string
): boolean => {
  const patterns = [
    "stop navigation",
    "cancel navigation",
    "navigation stop",
    "navigation band",
    "navigation bandh",
    "navigation rok",
    "navigation roko",

    "stop route",
    "cancel route",
    "route band",
    "route bandh",
    "route rok",

    "rasta band",
    "rasta bandh",
    "rasta roko",
    "raasta band",
    "raasta bandh",
    "raasta roko",

    "नेविगेशन बंद",
    "नेविगेशन बंद करो",
    "नेविगेशन रोक",
    "नेविगेशन रोक दो",
    "रास्ता बंद",
    "रास्ता बंद करो",
    "रास्ता रोक",
    "रास्ता रोक दो",
    "स्टॉप नेविगेशन",
    "स्टॉप नेविगेशन करो",
    "नेविगेशन स्टॉप",
  ];

  return patterns.some(
    (pattern) =>
      text.includes(pattern)
  );
};

// ============================================================
// NEARBY CATEGORIES
// ============================================================

interface NearbyCategory {
  category: string;

  spokenEnglish: string;
  spokenHindi: string;
  spokenHinglish: string;

  keywords: string[];
}

const nearbyCategories: NearbyCategory[] = [
  {
    category: "hospital",

    spokenEnglish: "hospital",
    spokenHindi: "अस्पताल",
    spokenHinglish: "hospital",

    keywords: [
      "hospital",
      "hospitals",
      "aspataal",
      "asptaal",

      "अस्पताल",
      "हॉस्पिटल",
    ],
  },

  {
    category: "petrol pump",

    spokenEnglish: "petrol pump",
    spokenHindi: "पेट्रोल पंप",
    spokenHinglish: "petrol pump",

    keywords: [
      "petrol",
      "petrol pump",
      "petrolpump",
      "fuel",
      "fuel station",
      "gas station",

      "पेट्रोल",
      "पेट्रोल पंप",
      "पेट्रोल पम्प",
      "ईंधन",
    ],
  },

  {
    category: "restaurant",

    spokenEnglish: "restaurant",
    spokenHindi: "रेस्टोरेंट",
    spokenHinglish: "restaurant",

    keywords: [
      "restaurant",
      "restaurants",
      "food",
      "food place",
      "khana",
      "khaana",
      "eat",

      "रेस्टोरेंट",
      "रेस्तरां",
      "खाना",
    ],
  },

  {
    category: "ATM",

    spokenEnglish: "ATM",
    spokenHindi: "एटीएम",
    spokenHinglish: "ATM",

    keywords: [
      "atm",
      "cash machine",
      "cash point",
      "cashpoint",

      "एटीएम",
      "ए टी एम",
    ],
  },

  {
    category: "police",

    spokenEnglish: "police station",
    spokenHindi: "पुलिस स्टेशन",
    spokenHinglish: "police station",

    keywords: [
      "police",
      "police station",
      "thana",

      "पुलिस",
      "पुलिस स्टेशन",
      "थाना",
    ],
  },
];

// ============================================================
// NEARBY WORDS
// ============================================================

const nearbyWords = [
  "near",
  "nearby",
  "nearest",
  "near me",
  "around me",
  "close to me",
  "close by",

  "paas",
  "paas mein",
  "pas",
  "pas mein",
  "nazdeek",
  "najdik",
  "najdeek",
  "aas paas",
  "aaspaas",

  "पास",
  "पास में",
  "आसपास",
  "आस पास",
  "नजदीक",
  "नज़दीक",
  "करीब",
];

// ============================================================
// FIND NEARBY CATEGORY
// ============================================================

const findNearbyCategory = (
  text: string
): NearbyCategory | null => {
  for (const item of nearbyCategories) {
    if (
      item.keywords.some(
        (keyword) =>
          text.includes(keyword)
      )
    ) {
      return item;
    }
  }

  return null;
};

// ============================================================
// HAS NEARBY MEANING
// ============================================================

const hasNearbyMeaning = (
  text: string
): boolean => {
  return nearbyWords.some(
    (word) =>
      text.includes(word)
  );
};

// ============================================================
// EXTRACT DESTINATION
// ============================================================

const extractDestination = (
  original: string
): string | null => {
  const value = original.trim();

  if (!value) {
    return null;
  }

  // ==========================================================
  // ENGLISH
  // ==========================================================

  const englishPatterns = [
    /^(?:please\s+)?go\s+to\s+(.+)$/i,

    /^(?:please\s+)?goto\s+(.+)$/i,

    /^(?:please\s+)?navigate\s+to\s+(.+)$/i,

    /^(?:please\s+)?navigate\s+(.+)$/i,

    /^(?:please\s+)?take\s+me\s+to\s+(.+)$/i,

    /^(?:please\s+)?drive\s+me\s+to\s+(.+)$/i,

    /^(?:please\s+)?drive\s+to\s+(.+)$/i,

    /^(?:please\s+)?route\s+to\s+(.+)$/i,

    /^(?:please\s+)?directions\s+to\s+(.+)$/i,

    /^(?:please\s+)?show\s+me\s+the\s+route\s+to\s+(.+)$/i,

    /^(?:please\s+)?show\s+me\s+route\s+to\s+(.+)$/i,

    /^(?:please\s+)?lead\s+me\s+to\s+(.+)$/i,

    /^(?:please\s+)?get\s+me\s+to\s+(.+)$/i,

    /^how\s+can\s+i\s+reach\s+(.+)$/i,

    /^how\s+do\s+i\s+reach\s+(.+)$/i,

    /^how\s+to\s+reach\s+(.+)$/i,
  ];

  for (const pattern of englishPatterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      const destination =
        cleanDestination(match[1]);

      if (destination) {
        return destination;
      }
    }
  }

  // ==========================================================
  // HINGLISH BASIC
  // ==========================================================

  const hinglishPatterns = [
    /^(.+?)\s+jana\s+hai$/i,

    /^(.+?)\s+jaana\s+hai$/i,

    /^(?:mujhe|mujhko)\s+(.+?)\s+jana\s+hai$/i,

    /^(?:mujhe|mujhko)\s+(.+?)\s+jaana\s+hai$/i,

    /^(?:mujhe|mujhko)\s+(.+?)\s+le\s+chalo$/i,

    /^(?:mujhe|mujhko)\s+(.+?)\s+le\s+jao$/i,

    /^(.+?)\s+le\s+chalo$/i,

    /^(.+?)\s+le\s+jao$/i,

    /^(.+?)\s+pahucha\s+do$/i,

    /^(.+?)\s+pahuncha\s+do$/i,
  ];

  for (const pattern of hinglishPatterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      const destination =
        cleanDestination(match[1]);

      if (destination) {
        return destination;
      }
    }
  }

  // ==========================================================
  // HINDI BASIC
  // ==========================================================

  const hindiPatterns = [
    /^(.+?)\s+जाना\s+है$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+जाना\s+है$/u,

    /^(.+?)\s+जाना\s+चाहता\s+हूं$/u,

    /^(.+?)\s+जाना\s+चाहती\s+हूं$/u,

    /^(.+?)\s+जाना\s+चाहता\s+हूँ$/u,

    /^(.+?)\s+जाना\s+चाहती\s+हूँ$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+ले\s+चलो$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+ले\s+जाओ$/u,

    /^(.+?)\s+पहुंचा\s+दो$/u,

    /^(.+?)\s+पहुँचा\s+दो$/u,
  ];

  for (const pattern of hindiPatterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      const destination =
        cleanDestination(match[1]);

      if (destination) {
        return destination;
      }
    }
  }

  // ==========================================================
  // HINDI ROUTE PATTERNS
  // ==========================================================

  const hindiRoutePatterns = [
    /^(.+?)\s+जाने\s+का\s+रास्ता$/u,

    /^(.+?)\s+जाने\s+का\s+रस्ता$/u,

    /^(.+?)\s+जाने\s+का\s+रूट$/u,

    /^(.+?)\s+जाने\s+का\s+मार्ग$/u,

    /^(.+?)\s+जाने\s+का\s+रास्ता\s+बताओ$/u,

    /^(.+?)\s+जाने\s+का\s+रास्ता\s+बताइए$/u,

    /^(.+?)\s+जाने\s+का\s+रास्ता\s+बताइये$/u,

    /^(.+?)\s+जाने\s+का\s+रास्ता\s+बताओ\s+ना$/u,

    /^(.+?)\s+जाने\s+का\s+रास्ता\s+लगाओ$/u,

    /^(.+?)\s+जाने\s+का\s+रास्ता\s+लगाइए$/u,

    /^(.+?)\s+जाने\s+का\s+रास्ता\s+लगाइये$/u,

    /^(.+?)\s+जाने\s+का\s+रास्ता\s+दिखाओ$/u,

    /^(.+?)\s+जाने\s+का\s+रास्ता\s+दिखाइए$/u,

    /^(.+?)\s+जाने\s+का\s+रूट\s+बताओ$/u,

    /^(.+?)\s+जाने\s+का\s+रूट\s+बताइए$/u,

    /^(.+?)\s+जाने\s+का\s+रूट\s+लगाओ$/u,

    /^(.+?)\s+जाने\s+का\s+रूट\s+लगाइए$/u,
  ];

  for (const pattern of hindiRoutePatterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      const destination =
        cleanDestination(match[1]);

      if (destination) {
        return destination;
      }
    }
  }

  // ==========================================================
  // HINDI ROUTE PATTERNS 2
  // ==========================================================

  const hindiRoutePatterns2 = [
    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रास्ता\s+बताओ$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रास्ता\s+बताइए$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रास्ता\s+बताइये$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रास्ता\s+लगाओ$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रास्ता\s+लगाइए$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रास्ता\s+लगाइये$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रास्ता\s+दिखाओ$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रास्ता\s+दिखाइए$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रूट\s+बताओ$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रूट\s+बताइए$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रूट\s+बताइये$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रूट\s+लगाओ$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रूट\s+लगाइए$/u,

    /^(?:मुझे|मुझको)\s+(.+?)\s+का\s+रूट\s+लगाइये$/u,

    /^(.+?)\s+का\s+रास्ता\s+बताओ$/u,

    /^(.+?)\s+का\s+रास्ता\s+बताइए$/u,

    /^(.+?)\s+का\s+रास्ता\s+बताइये$/u,

    /^(.+?)\s+का\s+रास्ता\s+लगाओ$/u,

    /^(.+?)\s+का\s+रास्ता\s+लगाइए$/u,

    /^(.+?)\s+का\s+रास्ता\s+लगाइये$/u,

    /^(.+?)\s+का\s+रास्ता\s+दिखाओ$/u,

    /^(.+?)\s+का\s+रास्ता\s+दिखाइए$/u,

    /^(.+?)\s+का\s+रूट\s+बताओ$/u,

    /^(.+?)\s+का\s+रूट\s+बताइए$/u,

    /^(.+?)\s+का\s+रूट\s+बताइये$/u,

    /^(.+?)\s+का\s+रूट\s+लगाओ$/u,

    /^(.+?)\s+का\s+रूट\s+लगाइए$/u,

    /^(.+?)\s+का\s+रूट\s+लगाइये$/u,
  ];

  for (const pattern of hindiRoutePatterns2) {
    const match = value.match(pattern);

    if (match?.[1]) {
      const destination =
        cleanDestination(match[1]);

      if (destination) {
        return destination;
      }
    }
  }

  // ==========================================================
  // HINGLISH ROUTE
  // ==========================================================

  const hinglishRoutePatterns = [
    /^(.+?)\s+ka\s+rasta$/i,

    /^(.+?)\s+ka\s+raasta$/i,

    /^(.+?)\s+ka\s+route$/i,

    /^(.+?)\s+ka\s+rasta\s+batao$/i,

    /^(.+?)\s+ka\s+raasta\s+batao$/i,

    /^(.+?)\s+ka\s+route\s+batao$/i,

    /^(.+?)\s+ka\s+rasta\s+bataiye$/i,

    /^(.+?)\s+ka\s+route\s+bataiye$/i,

    /^(.+?)\s+ka\s+rasta\s+lagao$/i,

    /^(.+?)\s+ka\s+route\s+lagao$/i,

    /^(.+?)\s+ka\s+rasta\s+dikhao$/i,

    /^(.+?)\s+ka\s+route\s+dikhao$/i,

    /^(?:mujhe|mujhko)\s+(.+?)\s+ka\s+rasta\s+batao$/i,

    /^(?:mujhe|mujhko)\s+(.+?)\s+ka\s+route\s+batao$/i,

    /^(?:mujhe|mujhko)\s+(.+?)\s+ka\s+rasta\s+lagao$/i,

    /^(?:mujhe|mujhko)\s+(.+?)\s+ka\s+route\s+lagao$/i,
  ];

  for (const pattern of hinglishRoutePatterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      const destination =
        cleanDestination(match[1]);

      if (destination) {
        return destination;
      }
    }
  }

  // ==========================================================
  // "WHERE IS X"
  // ==========================================================

  const reachPatterns = [
    /^where\s+is\s+(.+)$/i,

    /^where\s+can\s+i\s+find\s+(.+)$/i,

    /^how\s+can\s+i\s+go\s+to\s+(.+)$/i,

    /^how\s+do\s+i\s+go\s+to\s+(.+)$/i,

    /^how\s+can\s+i\s+reach\s+(.+)$/i,

    /^how\s+do\s+i\s+reach\s+(.+)$/i,

    /^मुझे\s+(.+?)\s+कैसे\s+पहुंचना\s+है$/u,

    /^मुझे\s+(.+?)\s+कैसे\s+पहुंचूं$/u,

    /^मुझे\s+(.+?)\s+कैसे\s+जाना\s+है$/u,
  ];

  for (const pattern of reachPatterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      const destination =
        cleanDestination(match[1]);

      if (destination) {
        return destination;
      }
    }
  }

  return null;
};

// ============================================================
// NEARBY REPLY
// ============================================================

const nearbyReply = (
  language: CommandLanguage,
  item: NearbyCategory
): string => {
  return replyByLanguage(
    language,

    `Finding the nearest ${item.spokenEnglish}.`,

    `सबसे नज़दीकी ${item.spokenHindi} खोज रहा हूँ।`,

    `Theek hai, nearest ${item.spokenHinglish} dhundh raha hoon.`
  );
};

// ============================================================
// LOCAL CHATBOT
// ============================================================

const localChatbot = (
  userText: string
): AIResult => {
  const original =
    userText.trim();

  const text =
    normalize(original);

  const language =
    detectLanguage(original);

  console.log(
    "[AI] Detected language:",
    language
  );

  // ========================================================
  // EMPTY
  // ========================================================

  if (!text) {
    return {
      reply: replyByLanguage(
        language,

        "Please tell me what you want me to do.",

        "कृपया बताइए कि आप क्या करना चाहते हैं।",

        "Please bataiye ki aap kya karna chahte hain."
      ),

      intent: "general",
    };
  }

  // ========================================================
  // GREETING
  // ========================================================

  if (
    /^(hi|hello|hey|hii|helo|namaste|good morning|good afternoon|good evening|नमस्ते|नमस्कार)$/u.test(
      text
    )
  ) {
    return {
      reply: replyByLanguage(
        language,

        "Hello! I am your Smart Voice Assistant. How can I help you?",

        "नमस्ते! मैं आपका स्मार्ट वॉइस असिस्टेंट हूँ। मैं आपकी कैसे मदद कर सकता हूँ?",

        "Hello! Main aapka Smart Voice Assistant hoon. Main aapki kaise help kar sakta hoon?"
      ),

      intent: "greeting",
    };
  }

  // ========================================================
  // ABOUT
  // ========================================================

  if (
    text.includes("who are you") ||
    text.includes("what are you") ||
    text.includes("tum kon ho") ||
    text.includes("tum kaun ho") ||
    text.includes("aap kon ho") ||
    text.includes("aap kaun ho") ||
    text.includes("आप कौन हो") ||
    text.includes("आप कौन हैं")
  ) {
    return {
      reply: replyByLanguage(
        language,

        "I am your Smart Voice Assistant. I can help with navigation, nearby places, and voice commands.",

        "मैं आपका स्मार्ट वॉइस असिस्टेंट हूँ। मैं नेविगेशन, आसपास की जगहों और वॉइस कमांड में आपकी मदद कर सकता हूँ।",

        "Main aapka Smart Voice Assistant hoon. Main navigation, nearby places aur voice commands mein aapki help kar sakta hoon."
      ),

      intent: "about",
    };
  }

  // ========================================================
  // HELP
  // ========================================================

  if (
    text === "help" ||
    text.includes("what can you do") ||
    text.includes("tum kya kar sakte ho") ||
    text.includes("aap kya kar sakte ho") ||
    text.includes("help me") ||
    text.includes("मदद")
  ) {
    return {
      reply: replyByLanguage(
        language,

        "I can navigate to places, open Home or Work, find nearby hospitals, petrol pumps, restaurants and ATMs, and stop navigation.",

        "मैं आपको जगहों पर नेविगेट कर सकता हूँ, घर या ऑफिस का रास्ता खोल सकता हूँ, आसपास अस्पताल, पेट्रोल पंप, रेस्टोरेंट और एटीएम खोज सकता हूँ और नेविगेशन बंद कर सकता हूँ।",

        "Main aapko places par navigate kar sakta hoon, Home ya Work ka route khol sakta hoon, nearby hospital, petrol pump, restaurant aur ATM dhoondh sakta hoon aur navigation stop kar sakta hoon."
      ),

      intent: "help",
    };
  }

  // ========================================================
  // THANKS
  // ========================================================

  if (
    text.includes("thank you") ||
    text.includes("thanks") ||
    text.includes("dhanyawad") ||
    text.includes("धन्यवाद")
  ) {
    return {
      reply: replyByLanguage(
        language,

        "You're welcome!",

        "आपका स्वागत है!",

        "You're welcome!"
      ),

      intent: "thanks",
    };
  }

  // ========================================================
  // HOW ARE YOU
  // ========================================================

  if (
    text.includes("how are you") ||
    text.includes("kaise ho") ||
    text.includes("kaisa hai") ||
    text.includes("कैसे हो") ||
    text.includes("कैसा है")
  ) {
    return {
      reply: replyByLanguage(
        language,

        "I am ready to help you with your navigation.",

        "मैं आपके नेविगेशन में मदद करने के लिए तैयार हूँ।",

        "Main aapke navigation mein help karne ke liye ready hoon."
      ),

      intent: "general",
    };
  }

  // ========================================================
  // CANCEL
  // ========================================================

  if (isCancelNavigation(text)) {
    return {
      reply: replyByLanguage(
        language,

        "Navigation cancelled.",

        "नेविगेशन बंद कर दिया गया है।",

        "Navigation band kar diya hai."
      ),

      intent: "cancel_navigation",
    };
  }

  // ========================================================
  // HOME
  // ========================================================

  if (isHomeCommand(text)) {
    return {
      reply: replyByLanguage(
        language,

        "Opening the route to Home.",

        "घर का रास्ता खोल रहा हूँ।",

        "Theek hai, ghar ka rasta khol raha hoon."
      ),

      intent: "navigate_home",

      destination: "Home",
    };
  }

  // ========================================================
  // WORK
  // ========================================================

  if (isWorkCommand(text)) {
    return {
      reply: replyByLanguage(
        language,

        "Opening the route to Work.",

        "ऑफिस का रास्ता खोल रहा हूँ।",

        "Theek hai, office ka rasta khol raha hoon."
      ),

      intent: "navigate_work",

      destination: "Work",
    };
  }

  // ========================================================
  // NEARBY
  // ========================================================

  const nearbyCategory =
    findNearbyCategory(text);

  const nearby =
    hasNearbyMeaning(text);

  if (
    nearbyCategory &&
    nearby
  ) {
    return {
      reply: nearbyReply(
        language,
        nearbyCategory
      ),

      intent: "nearby_search",

      category:
        nearbyCategory.category,
    };
  }

  // ========================================================
  // DIRECT NEARBY
  // ========================================================

  for (
    const item of nearbyCategories
  ) {
    const categoryName =
      item.category.toLowerCase();

    const spoken =
      item.spokenEnglish.toLowerCase();

    if (
      text === categoryName ||
      text === spoken ||
      text === `find ${categoryName}` ||
      text === `find ${spoken}` ||
      text === `nearest ${categoryName}` ||
      text === `nearest ${spoken}` ||
      text === `find nearest ${categoryName}` ||
      text === `find nearest ${spoken}`
    ) {
      return {
        reply: nearbyReply(
          language,
          item
        ),

        intent: "nearby_search",

        category:
          item.category,
      };
    }
  }

  // ========================================================
  // TRAFFIC
  // ========================================================

  if (
    text.includes("traffic") ||
    text.includes("traffic update") ||
    text.includes("traffic kaisa") ||
    text.includes("traffic batao") ||
    text.includes("ट्रैफिक") ||
    text.includes("यातायात")
  ) {
    return {
      reply: replyByLanguage(
        language,
        "Traffic information is available when live traffic data is connected.",
        "लाइव ट्रैफिक डेटा कनेक्ट होने पर मैं ट्रैफिक की जानकारी दे सकता हूँ।",
        "Live traffic data connect hone par main traffic ki information de sakta hoon."
      ),
      intent: "traffic",
    };
  }

  // ========================================================
  // WEATHER
  // ========================================================

  if (
    text.includes("weather") ||
    text.includes("mausam") ||
    text.includes("मौसम")
  ) {
    return {
      reply: replyByLanguage(
        language,
        "Weather information is available when a weather service is connected.",
        "मौसम की जानकारी के लिए वेदर सर्विस कनेक्ट करनी होगी।",
        "Weather information ke liye weather service connect karni hogi."
      ),
      intent: "weather",
    };
  }

  // ========================================================
  // MUSIC
  // ========================================================

  if (
    text.includes("play music") ||
    text.includes("music chalao") ||
    text.includes("gaana chalao") ||
    text.includes("गाना चलाओ") ||
    text.includes("म्यूजिक चलाओ")
  ) {
    return {
      reply: replyByLanguage(
        language,
        "Opening music controls.",
        "म्यूजिक कंट्रोल खोल रहा हूँ।",
        "Theek hai, music controls khol raha hoon."
      ),
      intent: "music",
    };
  }

  // ========================================================
  // CALL
  // ========================================================

  const callMatch =
    text.match(/^(?:call|phone|dial)\s+(.+)$/i) ||
    text.match(/^(?:mujhe|mujhko)\s+(.+?)\s+ko\s+call\s+karna\s+hai$/i);

  if (
    callMatch?.[1] ||
    text.includes("call karo") ||
    text.includes("call kar") ||
    text.includes("कॉल करो") ||
    text.includes("फोन करो")
  ) {
    const contact = callMatch?.[1]?.trim();

    return {
      reply: replyByLanguage(
        language,
        contact
          ? `Preparing a call to ${contact}.`
          : "Please tell me the contact name you want to call.",
        contact
          ? `${contact} को कॉल करने की तैयारी कर रहा हूँ।`
          : "कृपया बताइए कि किस कॉन्टैक्ट को कॉल करना है।",
        contact
          ? `Theek hai, ${contact} ko call karne ki taiyari kar raha hoon.`
          : "Bataiye kis contact ko call karna hai."
      ),
      intent: contact ? "call" : "general",
      destination: contact,
    };
  }

  // ========================================================
  // EMERGENCY / SOS
  // ========================================================

  if (
    text.includes("emergency") ||
    text.includes("sos") ||
    text.includes("help me emergency") ||
    text.includes("madad chahiye") ||
    text.includes("मदद चाहिए") ||
    text.includes("आपातकाल")
  ) {
    return {
      reply: replyByLanguage(
        language,
        "Emergency mode requested. Please confirm before contacting your emergency contact.",
        "इमरजेंसी मोड का अनुरोध किया गया है। इमरजेंसी कॉन्टैक्ट को संपर्क करने से पहले पुष्टि करें।",
        "Emergency mode requested hai. Emergency contact ko contact karne se pehle confirm karein."
      ),
      intent: "emergency",
    };
  }

  // ========================================================
  // NAVIGATION
  // ========================================================

  const destination =
    extractDestination(original);

  if (destination) {
    const destinationText =
      normalize(destination);

    // ------------------------------------------------------
    // HOME
    // ------------------------------------------------------

    if (
      isHomeCommand(destinationText)
    ) {
      return {
        reply: replyByLanguage(
          language,

          "Opening the route to Home.",

          "घर का रास्ता खोल रहा हूँ।",

          "Theek hai, ghar ka rasta khol raha hoon."
        ),

        intent: "navigate_home",

        destination: "Home",
      };
    }

    // ------------------------------------------------------
    // WORK
    // ------------------------------------------------------

    if (
      isWorkCommand(destinationText)
    ) {
      return {
        reply: replyByLanguage(
          language,

          "Opening the route to Work.",

          "ऑफिस का रास्ता खोल रहा हूँ।",

          "Theek hai, office ka rasta khol raha hoon."
        ),

        intent: "navigate_work",

        destination: "Work",
      };
    }

    // ------------------------------------------------------
    // NORMAL DESTINATION
    // ------------------------------------------------------

    return {
      reply: replyByLanguage(
        language,

        `Opening the route to ${destination}.`,

        `${destination} का रास्ता खोल रहा हूँ।`,

        `Theek hai, ${destination} ka rasta khol raha hoon.`
      ),

      intent: "navigate",

      destination,
    };
  }

  // ========================================================
  // GOOD MORNING
  // ========================================================

  if (
    text.includes("good morning")
  ) {
    return {
      reply: replyByLanguage(
        language,

        "Good morning! How can I help you today?",

        "सुप्रभात! आज मैं आपकी कैसे मदद कर सकता हूँ?",

        "Good morning! Aaj main aapki kaise help kar sakta hoon?"
      ),

      intent: "general",
    };
  }

  // ========================================================
  // GOOD NIGHT
  // ========================================================

  if (
    text.includes("good night")
  ) {
    return {
      reply: replyByLanguage(
        language,

        "Good night. Drive safely.",

        "शुभ रात्रि। सुरक्षित ड्राइव करें।",

        "Good night. Safely drive karna."
      ),

      intent: "general",
    };
  }

  // ========================================================
  // UNKNOWN
  // ========================================================

  return {
    reply: replyByLanguage(
      language,

      "I couldn't understand what you want me to do.",

      "मैं समझ नहीं पाया कि आप क्या करना चाहते हैं।",

      "Main samajh nahi paaya ki aap kya karna chahte hain."
    ),

    intent: "unknown",
  };
};

// ============================================================
// REAL GEMINI + LOCAL FALLBACK
// ============================================================

import Constants from "expo-constants";

const AI_API_BASE_URL =
  Constants.expoConfig?.extra?.aiApiBaseUrl ??
  "http://192.168.29.87:3000";

const parseGeminiResult = (
  data: any
): AIResult => {
  const allowedIntents = new Set([
    "navigate",
    "navigate_home",
    "navigate_work",
    "nearby_search",
    "cancel_navigation",
    "traffic",
    "weather",
    "call",
    "music",
    "general_chat",
    "emergency",
    "greeting",
    "general",
    "help",
    "about",
    "thanks",
    "unknown",
  ]);

  const intent = allowedIntents.has(
    String(data?.intent || "")
  )
    ? String(data.intent)
    : "unknown";

  return {
    reply:
      typeof data?.reply === "string" &&
      data.reply.trim()
        ? data.reply.trim()
        : "I couldn't understand that command.",

    intent,

    destination:
      typeof data?.destination === "string" &&
      data.destination.trim()
        ? data.destination.trim()
        : undefined,

    category:
      typeof data?.category === "string" &&
      data.category.trim()
        ? data.category.trim()
        : undefined,
  };
};

const askGeminiBackend = async (
  userText: string
): Promise<AIResult> => {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    10000
  );

  try {
    let lastError: unknown = null;

    // Retry transient backend/API failures once before using local fallback
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(
          `${AI_API_BASE_URL}/api/ai`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: userText,
            }),
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          const error = new Error(
            `AI backend returned ${response.status}`
          );

          // Retry 500+ and 429 errors once
          if (
            (response.status >= 500 ||
              response.status === 429) &&
            attempt < 2
          ) {
            lastError = error;

            await new Promise((resolve) =>
              setTimeout(resolve, 500)
            );

            continue;
          }

          throw error;
        }

        const data = await response.json();
        const result = parseGeminiResult(data);

        // Always prioritize local navigation-stop detection.
        // Gemini can sometimes return "unknown" for Hindi commands.
        if (isCancelNavigation(normalize(userText))) {
          return {
            ...result,
            reply: replyByLanguage(
              detectLanguage(userText),
              "Navigation cancelled.",
              "नेविगेशन बंद कर दिया गया है।",
              "Navigation band kar diya hai."
            ),
            intent: "cancel_navigation",
            destination: undefined,
          };
        }

        return result;
      } catch (error) {
        lastError = error;

        if (attempt >= 2) {
          throw error;
        }

        const message = String(
          error instanceof Error
            ? error.message
            : error
        );

        // Retry temporary network/backend failures
        if (
          message.includes("AI backend returned 5") ||
          message.includes("AI backend returned 429") ||
          message.includes("fetch failed") ||
          message.includes("Network request failed")
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, 500)
          );

          continue;
        }

        throw error;
      }
    }

    throw (
      lastError ??
      new Error("AI backend request failed")
    );
  } finally {
    clearTimeout(timeout);
  }
};

// Main AI function used by VoiceTab.
//
// Priority:
// 1. Real Gemini backend
// 2. Existing local Hindi/Hinglish parser as fallback
export async function askAI(
  userText: string
): Promise<AIResult> {
  const cleanText =
    userText.trim();

  console.log(
    "[AI] Processing command:",
    cleanText
  );

  if (!cleanText) {
    return localChatbot(cleanText);
  }

  try {
    const result =
      await askGeminiBackend(cleanText);

    console.log(
      "[AI] Gemini result:",
      JSON.stringify(result)
    );

    return result;
  } catch (error) {
    console.warn(
      "[AI] Gemini unavailable. Using local fallback.",
      error
    );

    try {
      const fallback =
        localChatbot(cleanText);

      console.log(
        "[AI] Local fallback result:",
        JSON.stringify(fallback)
      );

      return fallback;
    } catch (fallbackError) {
      console.error(
        "[AI] Local fallback failed:",
        fallbackError
      );

      return {
        reply:
          "Sorry, I couldn't process that command.",
        intent: "unknown",
      };
    }
  }
}