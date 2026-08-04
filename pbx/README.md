# PBX assets

These live on the Asterisk droplet and are kept here so a rebuild doesn't lose
them. Nothing here deploys automatically.

- `otp.conf` -> `/etc/asterisk/extensions.d/otp.conf`, then `asterisk -rx 'dialplan reload'`
- `sounds/*.wav` -> `/usr/share/asterisk/sounds/en/telroi/`

The audio is one ElevenLabs voice, generated once: intro, the repeat line, ten
digits and the closing warning. Nothing is synthesised per call, so volume costs
only carrier minutes and the code never leaves the machine.
