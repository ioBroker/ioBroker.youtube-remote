<img src="admin/youtube-remote.svg" alt="YouTube remote" width="80"/>

# ioBroker.youtube-remote

Controls the YouTube app of TVs, Android TV / Google TV, Fire TV and game consoles - every device whose YouTube app
offers "Link with TV": plays videos, playlists and channels and shows what plays.

## Adding devices

In the tab **Devices** of the settings:

- **Search** finds devices with the YouTube app in the network (DIAL). **Add** pairs a found device; it reports
  its YouTube screen mostly only while the app runs, so the adapter tries to start it - if that does not work, open
  YouTube on the device once.
- **Pair with TV code** works for every device: the YouTube app shows the code under Settings > Link with TV code.

## States

Per device `youtube-remote.0.<device>`, in the form of the type-detector type `mediaPlayer`, so visualizations and the
devices adapter show it as a player:

| State                           | Role                     | Description                                                                            |
| ------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `youtube`                       | text                     | play a video ID, a playlist (`PL…`), the uploads of a channel (`UC…`) or a YouTube URL |
| `play`, `pause`, `next`, `prev` | button.*                 | player commands                                                                        |
| `state`                         | media.state              | 0 pause, 1 play, 2 stop                                                                |
| `playerState`                   | value                    | unstarted, ended, playing, paused, buffering, cued, advertisement                      |
| `title`, `artist`, `cover`      | media.*                  | title, channel and picture of the video (oEmbed of YouTube, can be switched off)       |
| `videoId`, `url`                | text                     | the playing video                                                                      |
| `duration`, `elapsed`           | media.*                  | length and position in seconds, as last reported by the TV                             |
| `seek`                          | media.seek               | jump to a position in seconds                                                          |
| `volume`, `muted`               | level.volume, media.mute | volume of the YouTube player                                                           |
| `connected`                     | indicator.reachable      | the YouTube app of the device is open                                                  |

A video waits up to 30 s for the YouTube app, so it can be written right after switching the TV on; player commands
wait 5 s. If the app does not come, `youtube` stays unacknowledged and a warning is logged.

Handles (`@name`) cannot be resolved without the YouTube Data API: use the channel ID `UC…` from the address of the
channel page.

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

### **WORK IN PROGRESS**

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
