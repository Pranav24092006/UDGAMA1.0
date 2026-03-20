// ==========================================================================
// Voice Navigation Module (SpeechSynthesis API)
// ==========================================================================

const VoiceNav = {
  isEnabled: true,
  synth: window.speechSynthesis,
  voiceToggleBtn: document.getElementById('voice-toggle'),
  currentUtterance: null,
  voicesLoaded: false,

  init() {
    // Wait for voices to load
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => {
        this.getVoices();
        this.voicesLoaded = true;
      };
    }
    this.getVoices();

    if (this.voiceToggleBtn) {
      this.voiceToggleBtn.addEventListener('click', () => {
        this.toggleVoice();
      });
    }
  },

  getVoices() {
    this.voices = this.synth.getVoices();
  },

  toggleVoice() {
    this.isEnabled = !this.isEnabled;
    if (this.isEnabled) {
      this.voiceToggleBtn.classList.add('active');
      this.voiceToggleBtn.querySelector('i').className = 'fa-solid fa-volume-high';
      this.speak("Voice navigation enabled.");
    } else {
      this.voiceToggleBtn.classList.remove('active');
      this.voiceToggleBtn.querySelector('i').className = 'fa-solid fa-volume-xmark';
      this.synth.cancel(); // Stop speaking immediately
    }
  },

  queue: [],
  isSpeaking: false,

  speak(text, priority = false) {
    if (!this.isEnabled) return;
    
    if (priority) {
      this.synth.cancel();
      this.queue = [];
      this.isSpeaking = false;
    }

    this.queue.push({ text, priority });
    this.processQueue();
  },

  processQueue() {
    if (this.isSpeaking || this.queue.length === 0) return;

    this.isSpeaking = true;
    const { text, priority } = this.queue.shift();
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Find preferred voice
    if (this.voices && this.voices.length > 0) {
      const preferredVoice = this.voices.find(v => v.lang === 'en-US' && v.name.includes('Google')) ||
                             this.voices.find(v => v.lang.startsWith('en'));
      if (preferredVoice) utterance.voice = preferredVoice;
    }

    utterance.rate = 1.0;
    utterance.pitch = priority ? 1.2 : 1.0;

    utterance.onend = () => {
      this.isSpeaking = false;
      this.processQueue(); // Play next in queue
    };

    utterance.onerror = () => {
      this.isSpeaking = false;
      this.processQueue();
    };

    this.synth.speak(utterance);
    this.currentUtterance = utterance;
  }
};

// =============================================
// AI Voice Assistant (Speech Recognition)
// =============================================
const VoiceAssistant = {
  recognition: null,
  isListening: false,
  onResultCallback: null,

  init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition not supported in this browser.");
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.lang = 'en-US';
    this.recognition.interimResults = false;

    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (this.onResultCallback) this.onResultCallback(transcript);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      document.getElementById('voice-overlay').classList.remove('active');
    };

    this.recognition.onerror = (event) => {
      console.error("Speech Recognition Error:", event.error);
      this.stop();
    };
  },

  start(callback) {
    if (!this.recognition) return;
    this.onResultCallback = callback;
    try {
      this.recognition.start();
      this.isListening = true;
      document.getElementById('voice-overlay').classList.add('active');
      document.getElementById('voice-overlay-text').innerText = "Listening...";
      VoiceNav.speak("I'm listening. Describe the emergency.", true);
    } catch (e) {
      console.error("Recognition already started", e);
    }
  },

  stop() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    }
  }
};

// Initialize voice on load
document.addEventListener('DOMContentLoaded', () => {
  VoiceNav.init();
  VoiceAssistant.init();
});
