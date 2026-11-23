# YouTube commands — Ocha Lidya

## Commands

| Command | Function |
|---|---|
| `.yts <query>` | Search YouTube and show result cards with video thumbnails. Open the list button on a card to choose MP3 or one of the MP4 resolutions detected for that video. |
| `.ytmp3 <youtube-url>` | Download the selected video's audio as MP3. |
| `.ytmp4 <youtube-url>` | Inspect the video's available MP4 resolutions and show a quality-selection list. |
| `.ytmp4 <youtube-url> <resolution>` | Download MP4 at the selected resolution, for example `720`, `720p`, `1080`, or `best`. |
| `.ytm <song title or artist>` | Search one YouTube result with an `official audio` search hint and send audio only as an MP3 file. Aliases: `.ytmusic`, `.ytplay`. |

### How to use the result carousel

1. Send `.yts <artist / title / keyword>`.
2. Swipe through the thumbnail cards.
3. Open **MP3 / MP4 · Pilih kualitas** on the chosen card.
4. Select **Unduh MP3** for sound only or one of the listed MP4 heights.
5. For a direct request, use `.ytmp3 <url>` or `.ytmp4 <url> <resolution>`.

The list is built from the video's `yt-dlp` format metadata. Only MP4 video formats with a detected height are listed; duplicate heights are collapsed. The MP3 row remains separate. When MP4 metadata is unavailable, a best-quality MP4 fallback is shown and the downloader reports if the format cannot be produced.

## `.ytm` audio isolation

`.ytm` is not a live audio stream inside a WhatsApp voice call. It sends an audio file message (`audio/mpeg`). Each request receives a unique temporary directory named `ocha-youtube-audio-*`; yt-dlp cache is disabled, the extractor is asked for MP3 only, and the temporary directory is removed after the file is read. This path does not call the MP4 downloader and does not reuse another request's temporary files.

If you require real-time music inside a WhatsApp voice call, that is a separate feature requiring a call/audio-streaming stack. This command deliberately does not create or manage a voice call.

## Server requirements

- Node.js 20.18+ (already required by Ocha Lidya).
- `yt-dlp` installed and available in `PATH`, or set `YT_DLP_BIN` to its executable path.
- FFmpeg and ffprobe installed and available in `PATH`; set `FFMPEG_LOCATION` if they are installed in a non-standard directory.
- Network access to YouTube and its media CDN.

Install yt-dlp using its official installation instructions: <https://github.com/yt-dlp/yt-dlp#installation>. FFmpeg installation guidance is available at <https://ffmpeg.org/download.html>. A typical Python installation is `python3 -m pip install -U "yt-dlp[default]"`; install FFmpeg through the operating system package manager or the official FFmpeg download page.

The command responds with an explicit missing-executable error when `yt-dlp` cannot be started. Installing Node dependencies alone does not install yt-dlp or FFmpeg.

## Resource limits and environment overrides

| Variable | Default | Purpose |
|---|---:|---|
| `YT_DLP_BIN` | `yt-dlp` | Executable path/name. |
| `FFMPEG_LOCATION` | empty | Optional FFmpeg binary/directory location. |
| `YOUTUBE_MAX_DOWNLOAD_MB` | `48` | Maximum accepted output file size (8–128 MB range). |
| `YOUTUBE_MAX_DURATION_SECONDS` | `1800` | Maximum video duration for download/metadata selection (30–7,200 seconds range). |
| `YOUTUBE_SEARCH_RESULTS` | `5` | Default search result count (2–8 range). |

Each search is bounded by a 90-second metadata timeout. Download jobs have a 180-second process timeout. Each individual download runs in its own temporary directory and is cleaned up after success/failure.

## Legal and technical notes

Use this feature only for videos or music that you own, are licensed to download, or have permission to save. Respect YouTube's terms and the rights of the creator. The bot does not bypass private videos, DRM, membership restrictions, or other access controls.

YouTube changes its player and delivery mechanisms periodically. Update yt-dlp when YouTube extraction stops working. The bot's format list is a snapshot from the time of the query; formats can disappear before download. A listed resolution is not a guarantee that the subsequent request will succeed.

MP4 extraction may require FFmpeg to merge separate video and audio streams. MP3 conversion also requires FFmpeg. Actual file delivery size may be further constrained by WhatsApp client/server upload limits, which are outside the local unit tests.
