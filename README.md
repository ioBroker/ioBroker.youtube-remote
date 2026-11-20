<img src="admin/youtube-remote.svg" alt="YouTube remote" width="80"/>

# ioBroker.youtube-remote

Controls the YouTube app of TVs, Android TV / Google TV, Fire TV and game consoles - every device whose YouTube app
offers "Link with TV": plays videos, playlists and channels, finds them by keywords and shows what plays.

## Adding devices

In the tab **Devices** of the settings:

- **Search** finds devices with the YouTube app in the network (DIAL). **Add** pairs a found device; it reports
  its YouTube screen mostly only while the app runs, so the adapter tries to start it - if that does not work, open
  YouTube on the device once.
- **Pair with TV code** works for every device: the YouTube app shows the code under **Settings** > **Link with TV code**.

The card of a device shows whether the YouTube app is open, what plays (title, channel) and has buttons for previous,
play, pause, next, the volume and mute. **More** shows the picture and the position of the video. **Search and play**
asks for keywords and lists what YouTube finds (videos, channels, playlists) to choose from.

## States

Per device `youtube-remote.0.<device>`, in the form of the type-detector type `mediaPlayer`, so visualizations and the
devices adapter show it as a player:

| State                            | Role                      | Description                                                                             |
|----------------------------------|---------------------------|-----------------------------------------------------------------------------------------|
| `youtube`                        | text                      | play a video ID, a playlist (`PL…`), a channel (`UC…`, `@handle`), a URL or words       |
| `search`                         | text                      | keywords, e.g. `Sailing Oceanaire`: plays the first hit YouTube finds                   |
| `play`, `pause`, `next`, `prev`  | button.*                  | player commands                                                                         |
| `state`                          | media.state               | 0 pause, 1 play, 2 stop                                                                 |
| `playerState`                    | value                     | unstarted, ended, playing, paused, buffering, cued, advertisement                       |
| `title`, `artist`, `cover`       | media.*                   | title, channel and picture of the video (oEmbed of YouTube, can be switched off)        |
| `videoId`, `url`                 | text                      | the playing video                                                                       |
| `duration`, `elapsed`            | media.*                   | length and position in seconds, as last reported by the TV                              |
| `seek`                           | media.seek                | jump to a position in seconds                                                           |
| `volume`, `muted`                | level.volume, media.mute  | volume of the YouTube player                                                            |
| `connected`                      | indicator.reachable       | the YouTube app of the device is open                                                   |

A video waits up to 30 s for the YouTube app, so it can be written right after switching the TV on; player commands
wait 5 s. If the app does not come, `youtube` stays unacknowledged and a warning is logged. The same holds for
`search`, and if YouTube finds nothing.

`youtube` also takes a handle (`@name`, `youtube.com/@name`, `/c/name`, `/user/name`): it plays the uploads of the
channel, newest first; a handle YouTube does not know (e.g. misspelt) is searched among the channels. Any other words
play the first hit YouTube finds for them, like `search`: a channel if the words name one (its uploads, newest
first), else mostly a video. The log (info) names what a handle or words resolved to.

## Messages for scripts and AI agents

`sendTo('youtube-remote.0', 'help', {})` answers `{ help, commands }`: a description of the devices, the states to
write and what they show, for AI agents (e.g. ioBroker.pi-agent) and script authors. `commands` lists every message
the instance answers (also the ones of the Device Manager) with `write: true` for the ones that change something.

`search` finds videos, channels and playlists by keywords; it plays nothing, so an agent or a script can choose and
then write the `id` to `youtube`:

```js
sendTo('youtube-remote.0', 'search', { query: 'Sailing Oceanaire', type: 'all', limit: 5 }, answer => {
    // answer.results: [{ type: 'channel', id: 'UCbmF2AHnpQsogOLW-MxBiJg', title: 'Sailing Oceanaire | Wik & Rox',
    //     handle: '@SailingOceanaire', subscribers: '13.6K subscribers', ... },
    //   { type: 'video', id: '0L27s5EjM2c', title: '30 Knots Forced Us Into ...', channel: 'Sailing Oceanaire | Wik & Rox',
    //     duration: 1034, views: '91,671 views', published: '1 month ago', ... }, ...]
    const video = answer.results?.find(r => r.type === 'video');
    if (video) {
        setState('youtube-remote.0.tv_1a2b3c4d.youtube', video.id);
    }
});
```

`type` is `all` (default, the mix of the YouTube results page), `video`, `channel` or `playlist`; `limit` 1-20
(default 10). The query can also be sent as a plain string. A channel ID plays the uploads of the channel, newest
first. On a failure the answer is `{ query, error }`. The texts (views, published) are in the language of the system.

The search uses the API of the YouTube web page, without an API key and without a quota. Like the Lounge API it is not
documented by Google and may change.

## Note

Commands and what plays go over the YouTube Lounge API of Google ("Link with TV") with
[@iobroker/youtube-lounge](https://github.com/ioBroker/youtube-lounge), so an internet connection is needed. Google
does not document this API; it may change. Only finding the devices stays in the local network. The lounge tokens are
stored encrypted.

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

## Changelog
### 0.2.0 (2026-11-20)

- (@GermanBluefox) Search YouTube by keywords: the message `search` lists videos, channels and playlists, the state `search` plays the first hit, and the device card has "Search and play"
- (@GermanBluefox) `youtube` takes handles (`@name`, `youtube.com/@name`) and plays the channel; other words play the first hit found
- (@GermanBluefox) A channel or a playlist without a video starts at its first video (the newest upload of a channel): the YouTube app of the TV ignored it before

### 0.1.0 (2026-11-19)

- (@GermanBluefox) Added the message "help": a description of the states and messages for AI agents (e.g. pi-agent), and common.supportedMessages.help

### 0.0.2 (2026-10-25)

- (@GermanBluefox) Device cards show state, title and channel, with play, pause, next, previous, volume and mute
- (@GermanBluefox) Commands wait for the YouTube app to open; `connected` shows whether it is open

### 0.0.1 (2026-10-24)

- (@GermanBluefox) Initial release

## License

MIT License

Copyright (c) 2026 Denis Haev <dogafox@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
