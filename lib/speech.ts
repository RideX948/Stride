export async function speak(text: string) {
  try {
    // Try dynamic import of expo-speech (native/Expo managed).
    // If it's not available, fall back to browser speechSynthesis if present.
    let handled = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("expo-speech");
      if (mod && typeof mod.speak === "function") {
        mod.speak(text);
        handled = true;
      }
    } catch (e) {
      // expo-speech not available
    }

    if (!handled && typeof window !== "undefined" && (window as any).speechSynthesis) {
      const utter = new SpeechSynthesisUtterance(text);
      (window as any).speechSynthesis.cancel();
      (window as any).speechSynthesis.speak(utter);
      handled = true;
    }

    return handled;
  } catch (err) {
    console.warn("[speak] failed", err);
    return false;
  }
}
