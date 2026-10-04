# Replay English

Replay English helps you improve your spoken English by recording what you actually say in meetings and practice sessions. It then shows you the mistakes you keep making.

Everything runs on your own computer. Your audio, transcripts and analysis are never sent to any cloud service.

## Download

**[⬇ Download ReplayEnglish-Setup.exe](https://github.com/Rezve/replay-english/releases/latest/download/ReplayEnglish-Setup.exe)** (Windows 10/11, 64-bit)

Or browse every version on the [Releases page](https://github.com/Rezve/replay-english/releases).

Run the installer and the app opens when it finishes. New versions download in the background, and a banner tells you when an update is ready to install.

> Windows SmartScreen may warn you because the installer isn't code-signed. If it does, click **More info → Run anyway**.

## Before you start

Replay English uses two free, local engines.

| Engine | What it does | How to get it |
|---|---|---|
| **Whisper** | Turns your speech into text | Installed from inside the app. Open the **Setup** page and download the binary (CPU, or CUDA 12 if you have an NVIDIA GPU) and a speech model. |
| **Ollama** | Checks your grammar and phrasing | Install from [ollama.com](https://ollama.com), then run `ollama pull qwen2.5:7b` in a terminal. |

The **Setup** page shows a green check next to each part once it's ready.

### Choosing a speech model

| Model | Size | Notes |
|---|---|---|
| base.en | 148 MB | Fast, good accuracy |
| small.en | 488 MB | Slower, better accuracy |
| medium.en | 1.5 GB | Slowest, best accuracy |

Multilingual versions (`base`, `small`, `medium`) are also available.

## Key features

### Two ways to record
- **Meeting mode** records your microphone and your computer's audio, so you can replay the whole conversation. Only *your* voice is analysed.
- **Solo practice** records only your microphone, for speaking practice on your own.

Each recording can be tagged with a **profile**, such as a client, a team or a class, so you can compare progress across different settings.

### Sentence-by-sentence report
After each recording you get a report with these tabs:
- **Transcript.** Everything you said, with timestamps.
- **Line-by-line.** Each sentence is marked clean or flagged. A flagged sentence shows your **original** words next to a **corrected** version, the mistake highlighted, and a short explanation. Click any line to hear that moment again.
- **Grammar (Full).** Issues that only show up across several sentences.
- **Vocabulary.** Other, more natural ways to say what you meant.
- **Fluency.** A fluency score, filler words ("um", "like", "you know"), repetitions and observations.
- **Summary** and **Action Items.** Key points of the conversation, plus tasks with their owners and deadlines.

### Clean-sentence score
The main score is the **percentage of your sentences that were correct**. If a sentence couldn't be checked (for example because Ollama wasn't running), it's left out of the score. The report then says the analysis is incomplete, so a failed check never shows up as a perfect score.

### Mistakes grouped into habits
Mistakes are sorted into 17 categories across three areas:
- **Grammar.** Subject-verb agreement, tenses, articles, prepositions, plurals, word order, conditionals and pronouns.
- **Vocabulary.** Word choice, false friends, collocations and register (formal vs casual).
- **Phrasing.** Awkward or non-idiomatic phrasing, redundancy, run-on sentences and incomplete thoughts.

Each mistake is matched to a specific rule, such as *"Missing 'the'"* or *"discuss about → discuss"*. The same habit is therefore tracked as one pattern even when it shows up in different sentences.

### Review queue
The **Review** page lists the habits you most need to work on across all your recordings. Recent and more serious mistakes rank higher. For each pattern you can:
- see every time it happened and replay the audio,
- read the rule, with a wrong and a right example,
- mark it as learning or mastered, or ignore it if it's a false alarm.

After several recordings without a particular mistake, the app suggests marking that pattern as mastered. If a mastered pattern shows up again, it goes back into your queue.

### Dashboard
See your progress over time: total recordings, the share of sentences you got right, average mistakes per recording, your most common issue and what to work on next. You can filter by profile.

### Settings
- Transcription language (English or Bengali)
- Whisper model, and Ollama model and address. You can point the app at an Ollama server in WSL, Docker or on another machine.
- Analysis depth, and the default mode for new recordings
- Audio chunk length and model context size, for slower or faster machines

## Privacy

Recordings, transcripts and results are stored in a local database under `%APPDATA%\Replay English`. The app only uses the internet to download the Whisper binary and models, and to check for app updates.

## For developers

See [CLAUDE.md](CLAUDE.md) for architecture, build commands and the release process.
