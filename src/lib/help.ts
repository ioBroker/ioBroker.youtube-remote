/**
 * The answer of the message "help": what the instance does and answers, written for an AI agent (e.g.
 * ioBroker.pi-agent, or the MCP server with `send_to`) and for script authors. Keep it in sync with `onMessage` and
 * `execute` in main.ts and with the Device Manager (dm-utils answers the `dm:` commands itself).
 */

/** The commands the instance answers. write: true if the command has an effect (pairs, removes, plays, writes) */
export const COMMANDS: { command: string; write: boolean }[] = [
    { command: 'help', write: false },
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
An agent can play a video, a playlist or the uploads of a channel on a TV, pause, resume, skip, jump, set the
volume of the YouTube player, and tell what plays. All of that is done by writing states; the messages only serve
the Device Manager of the admin.

Commands (sendTo youtube-remote.0):
- help: this text; answer {help, commands: [{command, write}]}.
- dm:instanceInfo, dm:loadDevices, dm:deviceInfo, dm:deviceStatus, dm:deviceDetails, dm:deviceControlState,
  dm:deviceLoadProgress (read) and dm:instanceAction, dm:deviceAction, dm:deviceControl, dm:actionProgress
  (search, pair, rename, remove, play, control): the Device Manager of the admin, for the settings, not for agents.

States (youtube-remote.0.<device>.*): one object of type device per paired TV, <device> = tv_ and 8 hex characters,
its common.name is the name the user gave it (list the devices below youtube-remote.0 to find them).
Control: write with ack false. Done = the adapter acknowledges it (ack true).
- youtube (string): what to play; it starts at once and replaces what plays. One of:
  a video ID (11 characters, e.g. dQw4w9WgXcQ); a playlist ID (PL..., also UU..., LL..., FL..., OL..., RD...);
  a channel ID (UC... 24 characters: plays the uploads of the channel); a youtube.com or youtu.be URL of a video
  (watch?v=, youtu.be/<id>, /shorts/<id>, /live/<id>), of a playlist (list=..., with v=... it starts at that video)
  or of a channel (/channel/UC...); or one of the words play, pause, next, previous.
  No search and no handles (@name): find the ID or URL first. It waits up to 30 s for the YouTube app (so it can
  be written right after switching the TV on); when sent, the adapter sets it back to "" with ack true. If it stays
  unacknowledged, the app did not come or the text is none of the above (a warning in the log).
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
- What to play: the adapter cannot search. If the user names a title, artist or channel instead of a link,
  find the video, playlist or channel ID first (or ask for a link) and say what you picked when you play it.
- Play, pause and change the volume only on the user's request; loud (volume above about 50) only when asked.
- If connected is false, the YouTube app is not open (the TV may be off): say so; this adapter cannot switch the TV
  on. After writing youtube, check that it was acknowledged (up to 30 s) before saying it plays.
- "What is playing": read state, title, artist, elapsed and duration of the device, e.g. "On Living room TV:
  <title> from <channel>, playing, 3:12 of 10:05". Positions as m:ss, not seconds.`;
