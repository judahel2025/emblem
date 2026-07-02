"""Local Piper TTS (offline, multi-speaker aware).

Voice IDs:
  Single-speaker:  "en_US-kristin-medium"
  Multi-speaker:   "en_US-libritts-high:0"   (model:speaker_id)

Models live in VEYRA_HOME/voices as *.onnx + *.onnx.json pairs.
"""

import io

from ..kernel.paths import VEYRA_HOME

VOICES_DIR = VEYRA_HOME / "voices"


def _parse_voice(voice: str | None):
    """Return (model_stem, speaker_id). speaker_id is None for single-speaker models."""
    if not voice:
        return None, None
    if ":" in voice:
        stem, sid = voice.rsplit(":", 1)
        try:
            return stem.strip(), int(sid)
        except ValueError:
            return stem.strip(), None
    return voice, None


def _models():
    if not VOICES_DIR.exists():
        return []
    return sorted(VOICES_DIR.glob("*.onnx"))


def available():
    try:
        import piper  # noqa: F401
    except Exception:
        return False
    return len(_models()) > 0


def voices():
    out = []
    for m in _models():
        import json
        meta = m.with_suffix(".onnx.json")
        n_speakers = 1
        try:
            with open(meta, encoding="utf-8") as f:
                d = json.load(f)
            n_speakers = d.get("num_speakers", 1)
        except Exception:
            pass
        if n_speakers > 1:
            out.append({"id": f"{m.stem}:0", "name": f"{m.stem} (multi-speaker, {n_speakers} voices)", "gender": "mixed", "locale": ""})
        else:
            out.append({"id": m.stem, "name": m.stem, "gender": "", "locale": ""})
    return out


def synth(text, voice=None):
    import wave
    from piper import PiperVoice
    from piper.config import SynthesisConfig

    models = _models()
    if not models:
        raise RuntimeError("No Piper voice models installed.")

    stem, speaker_id = _parse_voice(voice)
    if stem:
        target = next((m for m in models if m.stem == stem), models[0])
    else:
        target = models[0]

    pv = PiperVoice.load(str(target))
    syn_cfg = SynthesisConfig(speaker_id=speaker_id) if speaker_id is not None else None

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        pv.synthesize_wav(text, wav, syn_config=syn_cfg)

    return buf.getvalue()
