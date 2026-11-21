/**
 * The answer of the message "help": what the instance does and answers, written for an AI agent (e.g.
 * ioBroker.pi-agent, or the MCP server with `send_to`) and for script authors. Keep it in sync with `onMessage` and
 * `execute` in main.ts and with the Device Manager (dm-utils answers the `dm:` commands itself).
 */

/**
 * The commands the instance answers. write: true if the command has an effect (pairs, removes, plays, writes);
 * standard: the command of the shared catalog of commands for adapter families (ioBroker.assistant HELP.md)
 */
export const COMMANDS: { command: string; write: boolean; standard?: string }[] = [
    { command: 'help', write: false },
    { command: 'search', write: false, standard: 'media.search' },
    { command: 'getPlayers', write: false, standard: 'media.getPlayers' },
    { command: 'play', write: true, standard: 'media.play' },
    { command: 'dm:instanceInfo', write: false },
    { command: 'dm:loadDevices', write: false },
    { command: 'dm:deviceInfo', write: false },
    { command: 'dm:deviceStatus', write: false },
    { command: 'dm:deviceDetails', write: false },
    { command: 'dm:instanceAction', write: true },
    { command: 'dm:deviceAction', write: true },
    { command: 'dm:deviceControl', write: true },
    { command: 'dm:deviceControlState', write: false },
    { command: 'dm:deviceLoadProgress', write: false },
    { command: 'dm:actionProgress', write: true },
];

export const HELP = `ioBroker.youtube-remote: controls the YouTube app of TVs, Android TV / Google TV, Fire TV and game consoles
(every device whose YouTube app offers "Link with TV"; the user pairs them in the tab Devices of the settings).
An agent can search YouTube, play a video, a playlist or the uploads of a channel on a TV, pause, resume, skip,
jump, set the volume of the YouTube player, and tell what plays. Searching, listing the devices and playing are
messages, the rest is done by writing states; the dm: messages only serve the Device Manager of the admin.
search, getPlayers and play follow the shared catalog of commands for media players (media.search,
media.getPlayers, media.play; marked with standard in the commands list of this answer).

Commands (sendTo youtube-remote.0; errors answer {error, reason?}):
- help: this text; answer {help, commands: [{command, write, standard?}]}.
- search: find videos, channels and playlists by keywords; reads only, plays nothing. Message {query, title?,
  artist?, album?, type, limit, offset?} or just the query as a string; query, title, artist and album are searched
  together. type: all (default, the mix of the YouTube results page), video (also track, song), channel (also
  artist) or playlist (also album); several different or other types search all. limit 1-20 (default 10), offset
  skips the first results (at most 20 in all). Answer {query, results, items} or {query, error, reason}. Results
  are ordered as YouTube ranks them, each {type, id, title, channel, channelId, duration (s, videos; 0 = live),
  live, views, published, videos (count of channels and playlists), handle, subscribers (channels), thumbnail};
  fields YouTube does not show are left out, the texts are in the language of the system. items: the same in the
  form of the catalog, {type, uri, id, name, artists?: [channel], durationSec?, live?, image?}. id (= uri) is what
  to write to youtube or give to play: a video ID, PL... (a playlist) or UC... (a channel: plays its uploads,
  newest first). No API key; uses the undocumented API of the YouTube web page, so it can fail (error) or miss
  fields when YouTube changes it.
- getPlayers: the paired devices, {players: [{id, name, room?, active, kinds: ["video"]}]}; id = <device> of the
  states, room = the ioBroker room of the device object, active = the YouTube app of the device is open.
- play {uri?, device?} (write): plays uri on the device like the state youtube (a video ID, PL..., UC..., a URL, a
  handle or other words: then the first hit), without uri it resumes. device: name or id of a device (getPlayers);
  without it the only device, or the only one whose YouTube app is open. Answers {ok: true, device: {id, name}}
  when the TV took the command (sent, not yet playing), or after 15 s {ok: true, pending: true, device} while it
  still waits for the YouTube app (up to 30 s; a failure then is only logged). Errors: reason DEVICE_NOT_FOUND
  (with devices: the names), AMBIGUOUS (with candidates), NOT_CONNECTED (the YouTube app did not come), NOT_FOUND
  (YouTube found nothing for the words), REPLACED (a newer command for the device came first). offset,
  positionSec and shuffle of the catalog are not supported and ignored.
- dm:instanceInfo, dm:loadDevices, dm:deviceInfo, dm:deviceStatus, dm:deviceDetails, dm:deviceControlState,
  dm:deviceLoadProgress (read) and dm:instanceAction, dm:deviceAction, dm:deviceControl, dm:actionProgress
  (search, pair, rename, remove, play, control): the Device Manager of the admin, for the settings, not for agents.

States (youtube-remote.0.<device>.*): one object of type device per paired TV, <device> = tv_ and 8 hex characters,
its common.name is the name the user gave it (list the devices below youtube-remote.0 to find them).
Control: write with ack false. Done = the adapter acknowledges it (ack true).
- search (string): keywords, e.g. "Sailing Oceanaire"; the adapter searches YouTube and at once plays the first
  hit, as YouTube ranks it: a channel if the words name one (its uploads, newest first), else mostly a video,
  sometimes a playlist. Like youtube it waits up to 30 s for the app, then sets it back to "" with ack true. The
  log (info) names what it played; title and artist show the video once it plays. If nothing is found, it stays
  unacknowledged with a warning in the log. Use it when the user wants something played and does not care which
  hit; to choose (a certain video, a playlist), use the message search and write the id to youtube.
- youtube (string): what to play; it starts at once and replaces what plays. One of:
  a video ID (11 characters, e.g. dQw4w9WgXcQ); a playlist ID (PL..., also UU..., LL..., FL..., OL..., RD...);
  a channel ID (UC... 24 characters: plays the uploads of the channel, newest first); a youtube.com or youtu.be URL
  of a video (watch?v=, youtu.be/<id>, /shorts/<id>, /live/<id>), of a playlist (list=..., with v=... it starts at
  that video) or of a channel (/channel/UC..., /@handle, /c/name, /user/name); a handle (@name: the uploads of the
  channel; a handle YouTube does not know, e.g. misspelt, is searched among the channels); one of the words play,
  pause, next, previous; or any other words: then the first hit YouTube finds for them plays, as with search.
  Do not guess IDs or handles: if unsure, send the message search first. It waits up to 30 s for the YouTube app
  (so it can be written right after switching the TV on); when sent, the adapter sets it back to "" with ack true
  and logs (info) what a handle or words resolved to. If it stays unacknowledged, the app did not come or YouTube
  found nothing (a warning in the log, level warn).
- play, pause, next, prev (boolean, write true): resume, pause, next and previous video of the playlist.
- seek (number, seconds): jump to that position of the video.
- volume (number 0-100 %): the volume of the YouTube player, not of the TV. muted (boolean): mute, unmute.
  These wait up to 5 s for the app; seek, volume and muted are acknowledged with the value written.
There is no stop (pause holds the video), and the TV itself (power, input, volume of the TV) is not switched here.
What plays (read-only, written by the adapter as the TV reports it):
- state: 1 play (also buffering and ads), 0 pause, 2 stop (nothing loaded, or ended).
- playerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued, 1081 advertisement.
- title, artist (= the channel), cover (URL of the picture), videoId, url (https://youtu.be/<videoId>): the video.
  title and artist stay empty if looking up titles is off in the settings or YouTube does not know the video.
- elapsed, duration: position and length in seconds, as last reported by the TV (not counted up in between).
- volume, muted: as reported. connected: true while the YouTube app of the device is open.

How to talk to the user:
- Which TV: if more than one device is paired and the user names none, ask which one; do not guess and do not
  take the one of an earlier request. Name devices by their name, never by tv_ IDs.
- What to play: if the user names a title, artist, show or channel instead of a link, send search with their
  words and pick what fits: the channel result if they name a channel and want "it" or its newest video (UC...
  plays the uploads, newest first), a playlist if they ask for one, else the first video. If the hits do not
  clearly fit, list two or three (title, channel, length as m:ss) and ask. Say what you picked when you play it:
  "Playing <title> from <channel> on <device>". Write the id of the result to youtube.
- Play (state youtube, search or the message play), pause and change the volume only on the user's request; loud
  (volume above about 50) only when asked.
- If connected is false, the YouTube app is not open (the TV may be off): say so; this adapter cannot switch the TV
  on. After writing youtube or search, check that it was acknowledged (up to 30 s): that means sent, not playing.
  Then check that videoId and title changed (a few seconds) before saying it plays; if they did not, say so. If it
  stays unacknowledged, read the log of the instance with level warn: it says why.
- "What is playing": read state, title, artist, elapsed and duration of the device, e.g. "On Living room TV:
  <title> from <channel>, playing, 3:12 of 10:05". Positions as m:ss, not seconds.`;
