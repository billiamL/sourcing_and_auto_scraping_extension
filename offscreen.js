// offscreen.js
/**
 * Creates and plays a silent audio loop.
 */
function playSilentAudio() {
  // An AudioContext is required to generate audio programmatically.
  const audioContext = new AudioContext();

  // Create an in-memory audio element. We don't need to add it to the page.
  const audio = new Audio();

  // Create a MediaStream destination to pipe our silent audio into.
  const streamDestination = audioContext.createMediaStreamDestination();

  // Connect the destination to the audio element's source.
  audio.srcObject = streamDestination.stream;

  // Set the audio to loop indefinitely.
  audio.loop = true;

  // The user must interact with a page for audio to play, but extensions
  // running in an offscreen document are exempt from this rule, allowing this to work.
  audio.play().catch(error => {
    // Log an error if for any reason playback fails.
    console.error("Silent audio playback failed:", error);
  });

  console.log("Silent audio has started to prevent background throttling.");
}

// Run the function as soon as the script is loaded.
playSilentAudio();