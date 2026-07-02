"""Emblem voice service — natural TTS + accurate STT, pluggable engines.

The browser captures the mic and plays audio; this backend runs the models:
  TTS:  edge (natural, online, 47 voices) | piper / kokoro (local, when models present)
  STT:  faster-whisper (local)
Engine + voice + rate are user-selectable and stored in kernel config.
"""
