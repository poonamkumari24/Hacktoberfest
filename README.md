# Keepsake

Keepsake is a private, offline-first oral-history notebook. Record a conversation in your browser, preserve its transcript and notes, and use an open-weight model running locally to find a gentle next question or summarize the story.

## What stays local

- Stories, notes, and recordings are stored in the browser's IndexedDB.
- The optional AI features talk only to Ollama on this computer. Story text is not sent to a hosted AI service; recordings are never sent to the model.
- The app itself has no third-party runtime dependencies. After Ollama and a model are installed, you can disconnect from the internet and continue using it.
- Browser storage is tied to this browser profile. Export a JSON archive regularly if you want a portable backup.

Keepsake does not automatically transcribe audio. Recordings stay attached to each story so you can listen back and enter or paste a transcript. Local speech transcription is a useful next step, but is not included in this version.

## Run it

1. Install [Node.js](https://nodejs.org/) 18 or newer.
2. Install [Ollama](https://ollama.com/) and download Qwen 2.5 1.5B (Apache-2.0-licensed weights), for example:

   ```powershell
   ollama pull qwen2.5:1.5b
   ```

3. Start Ollama if it is not already running, then start Keepsake from this folder:

   ```powershell
   node server.js
   ```

4. Open [http://127.0.0.1:4173](http://127.0.0.1:4173). Pick the downloaded model in the AI panel.

Keepsake remains usable without Ollama; only the question and summary actions need the local model. The first model download requires internet. Once installed, Ollama inference and all story storage are local.

## Use

- Create a story and add the storyteller, date, transcript, and your own notes.
- Record audio in the browser or attach an existing audio file. Keep the tab open while recording.
- Ask for a follow-up question or a summary. Treat generated text as a draft and keep the storyteller's own words as the source of truth.
- Use **Export archive** for a JSON backup, including recorded audio. **Import archive** restores a backup into the current browser.

Allow microphone access when prompted to record. Exported archives may contain sensitive personal stories and audio; store and share them carefully.

## Technology

Plain HTML, CSS, and JavaScript; browser IndexedDB and MediaRecorder; a small Node.js server; and an optional local Ollama API backed by an open-weight model. No account, telemetry, cloud database, or hosted inference is used.
