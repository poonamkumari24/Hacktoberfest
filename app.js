const dbRequest = indexedDB.open("keepsake-archive", 1);
dbRequest.onupgradeneeded = () => {
  dbRequest.result.createObjectStore("stories", { keyPath: "id" });
};

const dbReady = new Promise((resolve, reject) => {
  dbRequest.onsuccess = () => resolve(dbRequest.result);
  dbRequest.onerror = () => reject(dbRequest.error);
});

const $ = (selector) => document.querySelector(selector);
const elements = {
  storyCount: $("#story-count"),
  storyList: $("#story-list"),
  newStory: $("#new-story"),
  emptyNewStory: $("#empty-new-story"),
  emptyState: $("#empty-state"),
  editor: $("#story-editor"),
  title: $("#story-title"),
  narrator: $("#story-narrator"),
  date: $("#story-date"),
  transcript: $("#story-transcript"),
  notes: $("#story-notes"),
  wordCount: $("#word-count"),
  saveStatus: $("#save-status"),
  deleteStory: $("#delete-story"),
  recordAudio: $("#record-audio"),
  attachAudio: $("#attach-audio"),
  audioFile: $("#audio-file"),
  audioPlayer: $("#audio-player"),
  modelSelect: $("#model-select"),
  refreshModels: $("#refresh-models"),
  askQuestion: $("#ask-question"),
  makeSummary: $("#make-summary"),
  aiStatus: $("#ai-status"),
  aiResult: $("#ai-result"),
  aiResultText: $("#ai-result-text"),
  addAiToNotes: $("#add-ai-to-notes"),
  exportArchive: $("#export-archive"),
  importArchive: $("#import-archive"),
  archiveFile: $("#archive-file"),
  toast: $("#toast"),
};

let stories = [];
let currentStoryId = null;
let saveTimer;
let toastTimer;
let recorder = null;
let recordingStream = null;
let recordingChunks = [];
let currentAudioUrl = null;
let latestAiResult = "";

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

async function readAllStories() {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const request = db.transaction("stories", "readonly").objectStore("stories").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeStory(story) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("stories", "readwrite");
    transaction.objectStore("stories").put(story);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Could not save this story."));
  });
}

async function removeStoredStory(id) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("stories", "readwrite");
    transaction.objectStore("stories").delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Could not remove this story."));
  });
}

function newStoryRecord() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    narrator: "",
    date: "",
    transcript: "",
    notes: "",
    audioBlob: null,
    updatedAt: now,
  };
}

function renderStoryList() {
  const sorted = [...stories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  elements.storyCount.textContent = String(stories.length);
  elements.storyList.replaceChildren();

  if (sorted.length === 0) {
    const empty = document.createElement("p");
    empty.className = "story-card-empty";
    empty.textContent = "Your archive is waiting for its first story.";
    elements.storyList.append(empty);
    return;
  }

  for (const story of sorted) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `story-card${story.id === currentStoryId ? " active" : ""}`;
    button.setAttribute("aria-current", story.id === currentStoryId ? "true" : "false");

    const title = document.createElement("span");
    title.className = "story-card-title";
    title.textContent = story.title.trim() || "Untitled story";
    const meta = document.createElement("span");
    meta.className = "story-card-meta";
    meta.textContent = [story.narrator.trim(), story.date.trim()].filter(Boolean).join(" · ") || "A story to remember";
    button.append(title, meta);
    button.addEventListener("click", () => openStory(story.id));
    elements.storyList.append(button);
  }
}

function updateWordCount() {
  const words = elements.transcript.value.trim().match(/\S+/g);
  const count = words ? words.length : 0;
  elements.wordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
}

function revokeAudioUrl() {
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = null;
  elements.audioPlayer.removeAttribute("src");
  elements.audioPlayer.hidden = true;
}

function renderEditor(story) {
  elements.emptyState.hidden = Boolean(story);
  elements.editor.hidden = !story;
  if (!story) {
    revokeAudioUrl();
    return;
  }

  elements.title.value = story.title || "";
  elements.narrator.value = story.narrator || "";
  elements.date.value = story.date || "";
  elements.transcript.value = story.transcript || "";
  elements.notes.value = story.notes || "";
  elements.saveStatus.textContent = "Saved on this device";
  updateWordCount();
  revokeAudioUrl();
  if (story.audioBlob instanceof Blob) {
    currentAudioUrl = URL.createObjectURL(story.audioBlob);
    elements.audioPlayer.src = currentAudioUrl;
    elements.audioPlayer.hidden = false;
  }
  elements.aiResult.hidden = true;
  renderStoryList();
}

async function openStory(id) {
  clearTimeout(saveTimer);
  const previous = collectEditorValues();
  if (previous) {
    try {
      await writeStory(previous);
    } catch (error) {
      showToast(`Could not save story: ${error.message}`);
    }
  }
  currentStoryId = id;
  const story = stories.find((item) => item.id === id);
  renderEditor(story || null);
}

function collectEditorValues() {
  const story = stories.find((item) => item.id === currentStoryId);
  if (!story) return null;
  story.title = elements.title.value;
  story.narrator = elements.narrator.value;
  story.date = elements.date.value;
  story.transcript = elements.transcript.value;
  story.notes = elements.notes.value;
  story.updatedAt = new Date().toISOString();
  return story;
}

function scheduleSave() {
  updateWordCount();
  const story = collectEditorValues();
  if (!story) return;
  elements.saveStatus.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await writeStory(story);
      elements.saveStatus.textContent = "Saved on this device";
      renderStoryList();
    } catch (error) {
      elements.saveStatus.textContent = "Could not save";
      showToast(`Could not save story: ${error.message}`);
    }
  }, 350);
}

async function createStory() {
  try {
    clearTimeout(saveTimer);
    const previous = collectEditorValues();
    if (previous) await writeStory(previous);
    const story = newStoryRecord();
    await writeStory(story);
    stories.push(story);
    currentStoryId = story.id;
    renderEditor(story);
    elements.title.focus();
  } catch (error) {
    showToast(`Could not create story: ${error.message}`);
  }
}

async function deleteCurrentStory() {
  const story = stories.find((item) => item.id === currentStoryId);
  if (!story) return;
  if (!window.confirm(`Remove "${story.title.trim() || "Untitled story"}" and its audio from this browser?`)) return;
  try {
    clearTimeout(saveTimer);
    await removeStoredStory(story.id);
    stories = stories.filter((item) => item.id !== story.id);
    currentStoryId = null;
    renderEditor(null);
    renderStoryList();
  } catch (error) {
    showToast(`Could not remove story: ${error.message}`);
  }
}

async function refreshModels() {
  elements.modelSelect.replaceChildren(new Option("Checking Ollama…", ""));
  try {
    const response = await fetch("/api/tags");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not read local models.");
    const models = Array.isArray(payload.models) ? payload.models : [];
    elements.modelSelect.replaceChildren();
    if (models.length === 0) {
      elements.modelSelect.add(new Option("No models installed", ""));
      setAiStatus("Install a local model with Ollama, then refresh this list.");
      return;
    }
    const savedModel = localStorage.getItem("keepsake-model");
    for (const model of models) {
      const name = model.name || model.model;
      if (name) elements.modelSelect.add(new Option(name, name));
    }
    if (savedModel && models.some((model) => (model.name || model.model) === savedModel)) {
      elements.modelSelect.value = savedModel;
    }
    setAiStatus("AI runs through Ollama on this computer. No cloud account needed.");
  } catch {
    elements.modelSelect.replaceChildren(new Option("Ollama unavailable", ""));
    setAiStatus("Start Ollama locally to enable AI. Your stories remain available without it.", true);
  }
}

function setAiStatus(message, isError = false) {
  elements.aiStatus.textContent = message;
  elements.aiStatus.classList.toggle("error", isError);
}

async function askLocalAi(kind) {
  const story = collectEditorValues();
  if (!story) return;
  const model = elements.modelSelect.value;
  if (!model) {
    setAiStatus("Choose an installed Ollama model first.", true);
    return;
  }
  if (!story.transcript.trim()) {
    setAiStatus("Add a few words to the transcript first so the model has something to work with.", true);
    return;
  }

  clearTimeout(saveTimer);
  try {
    await writeStory(story);
    elements.saveStatus.textContent = "Saved on this device";
    const questionMode = kind === "question";
    const instruction = questionMode
      ? "Suggest one gentle, open-ended follow-up question that could help the storyteller share more. Refer only to what is already in the story. Do not invent details, make assumptions, or ask about trauma. Return only the question."
      : "Write a concise, faithful summary of the story in 3 to 5 sentences. Preserve the storyteller's perspective and key details. Do not invent, infer, or embellish anything. If information is unclear, leave it out.";
    const context = [
      `Story title: ${story.title.trim() || "Untitled story"}`,
      story.narrator.trim() ? `Told by: ${story.narrator.trim()}` : "",
      story.date.trim() ? `When: ${story.date.trim()}` : "",
      `Transcript:\n${story.transcript}`,
      story.notes.trim() ? `Listener's notes:\n${story.notes}` : "",
    ].filter(Boolean).join("\n\n");

    for (const button of [elements.askQuestion, elements.makeSummary]) button.disabled = true;
    setAiStatus("Thinking locally…");
    elements.aiResult.hidden = true;
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: `You are a careful oral-history companion. ${instruction}` },
          { role: "user", content: context },
        ],
        options: { temperature: 0.3 },
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.message || "The local model could not respond.");
    latestAiResult = payload.message?.content?.trim() || "";
    if (!latestAiResult) throw new Error("The local model returned an empty response.");
    elements.aiResultText.textContent = latestAiResult;
    elements.aiResult.hidden = false;
    setAiStatus("Generated on your computer. Review before saving it to the story.");
  } catch (error) {
    setAiStatus(error.message, true);
  } finally {
    for (const button of [elements.askQuestion, elements.makeSummary]) button.disabled = false;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read audio for export."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:audio/")) {
    throw new Error("An archive contains an invalid audio attachment.");
  }
  const [metadata, encoded] = dataUrl.split(",", 2);
  const mimeType = metadata.match(/^data:(audio\/[^;]+)/)?.[1];
  if (!mimeType || !encoded) throw new Error("An archive contains an invalid audio attachment.");
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

async function exportArchive() {
  try {
    if (currentStoryId) {
      clearTimeout(saveTimer);
      const current = collectEditorValues();
      if (current) await writeStory(current);
    }
    const archiveStories = await Promise.all(stories.map(async (story) => ({
      ...story,
      audioDataUrl: story.audioBlob instanceof Blob ? await blobToDataUrl(story.audioBlob) : null,
      audioBlob: undefined,
    })));
    const archive = { format: "keepsake-archive-v1", stories: archiveStories };
    const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `keepsake-archive-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Archive exported. Keep the file somewhere private.");
  } catch (error) {
    showToast(`Could not export archive: ${error.message}`);
  }
}

async function importArchive(file) {
  try {
    const archive = JSON.parse(await file.text());
    if (archive?.format !== "keepsake-archive-v1" || !Array.isArray(archive.stories)) {
      throw new Error("This is not a Keepsake archive.");
    }
    const imported = archive.stories.map((item) => {
      if (!item || typeof item.id !== "string" || typeof item.transcript !== "string") {
        throw new Error("The archive contains an invalid story.");
      }
      return {
        id: item.id,
        title: typeof item.title === "string" ? item.title : "",
        narrator: typeof item.narrator === "string" ? item.narrator : "",
        date: typeof item.date === "string" ? item.date : "",
        transcript: item.transcript,
        notes: typeof item.notes === "string" ? item.notes : "",
        audioBlob: item.audioDataUrl ? dataUrlToBlob(item.audioDataUrl) : null,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      };
    });
    const db = await dbReady;
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("stories", "readwrite");
      for (const story of imported) transaction.objectStore("stories").put(story);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Could not restore archive."));
    });
    stories = await readAllStories();
    currentStoryId = null;
    renderEditor(null);
    renderStoryList();
    showToast(`${imported.length} ${imported.length === 1 ? "story" : "stories"} restored.`);
  } catch (error) {
    showToast(`Could not import archive: ${error.message}`);
  } finally {
    elements.archiveFile.value = "";
  }
}

async function startRecording() {
  if (!currentStoryId) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("Audio recording is not supported in this browser.");
    return;
  }
  elements.recordAudio.disabled = true;
  try {
    const recordingStoryId = currentStoryId;
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    recorder = new MediaRecorder(recordingStream);
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) recordingChunks.push(event.data);
    });
    recorder.addEventListener("stop", async () => {
      const story = stories.find((item) => item.id === recordingStoryId);
      if (story) {
        story.audioBlob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
        story.updatedAt = new Date().toISOString();
        try {
          await writeStory(story);
          renderEditor(story);
          setAiStatus("Recording saved on this device. Add a transcript to ask the local model for help.");
        } catch (error) {
          showToast(`Could not save recording: ${error.message}`);
        }
      }
      recordingStream?.getTracks().forEach((track) => track.stop());
      recordingStream = null;
      recorder = null;
      elements.recordAudio.disabled = false;
      elements.recordAudio.textContent = "● Record";
      elements.recordAudio.classList.remove("recording");
    });
    recorder.start();
    elements.recordAudio.disabled = false;
    elements.recordAudio.textContent = "■ Stop recording";
    elements.recordAudio.classList.add("recording");
  } catch (error) {
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = null;
    recorder = null;
    elements.recordAudio.disabled = false;
    showToast(`Could not start recording: ${error.message}`);
  }
}

function stopRecording() {
  if (recorder?.state === "recording") {
    elements.recordAudio.disabled = true;
    recorder.stop();
  }
}

async function attachAudio(file) {
  const story = stories.find((item) => item.id === currentStoryId);
  if (!story || !file) return;
  if (!file.type.startsWith("audio/")) {
    showToast("Choose an audio file.");
    return;
  }
  try {
    clearTimeout(saveTimer);
    collectEditorValues();
    story.audioBlob = file;
    story.updatedAt = new Date().toISOString();
    await writeStory(story);
    renderEditor(story);
    showToast("Audio saved on this device.");
  } catch (error) {
    showToast(`Could not attach audio: ${error.message}`);
  } finally {
    elements.audioFile.value = "";
  }
}

for (const input of [elements.title, elements.narrator, elements.date, elements.transcript, elements.notes]) {
  input.addEventListener("input", scheduleSave);
}
elements.newStory.addEventListener("click", createStory);
elements.emptyNewStory.addEventListener("click", createStory);
elements.deleteStory.addEventListener("click", deleteCurrentStory);
elements.recordAudio.addEventListener("click", () => {
  if (recorder?.state === "recording") stopRecording();
  else startRecording();
});
elements.attachAudio.addEventListener("click", () => elements.audioFile.click());
elements.audioFile.addEventListener("change", () => attachAudio(elements.audioFile.files[0]));
elements.modelSelect.addEventListener("change", () => {
  if (elements.modelSelect.value) localStorage.setItem("keepsake-model", elements.modelSelect.value);
});
elements.refreshModels.addEventListener("click", refreshModels);
elements.askQuestion.addEventListener("click", () => askLocalAi("question"));
elements.makeSummary.addEventListener("click", () => askLocalAi("summary"));
elements.addAiToNotes.addEventListener("click", () => {
  const addition = `${elements.notes.value.trim() ? "\n\n" : ""}${latestAiResult}`;
  elements.notes.value += addition;
  scheduleSave();
  showToast("Added to your notes.");
});
elements.exportArchive.addEventListener("click", exportArchive);
elements.importArchive.addEventListener("click", () => elements.archiveFile.click());
elements.archiveFile.addEventListener("change", () => {
  if (elements.archiveFile.files[0]) importArchive(elements.archiveFile.files[0]);
});

async function initialize() {
  try {
    stories = await readAllStories();
    renderStoryList();
    if (stories.length > 0) {
      const mostRecent = [...stories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      openStory(mostRecent.id);
    }
  } catch (error) {
    showToast(`Could not open the local archive: ${error.message}`);
  }
  refreshModels();
}

initialize();
