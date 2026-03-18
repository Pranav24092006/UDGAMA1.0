// ==========================================================================
// Voice Navigation Module (SpeechSynthesis API)
// ==========================================================================

const VoiceNav = {
  isEnabled: true,
  synth: window.speechSynthesis,
  voiceToggleBtn: document.getElementById('voice-toggle'),
  currentUtterance: null,

  init() {
    // Wait for voices to load
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = this.getVoices.bind(this);
    }

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

  speak(text) {
    if (!this.isEnabled) return;
    
    // Cancel any ongoing speech
    if (this.synth.speaking) {
      this.synth.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Try to find a good English voice
    if (this.voices && this.voices.length > 0) {
      const preferredVoice = this.voices.find(v => v.lang === 'en-US' && v.name.includes('Google')) ||
                             this.voices.find(v => v.lang.startsWith('en'));
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.1; // Slightly higher pitch for urgency/clarity

    this.synth.speak(utterance);
    this.currentUtterance = utterance;
  }
};

// Initialize voice on load
document.addEventListener('DOMContentLoaded', () => {
  VoiceNav.init();
});
