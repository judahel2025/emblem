"""XTTS-v2 zero-shot voice clone engine (local, CPU, free).

Uses the pre-downloaded model at ROOT/models/xtts_v2 and the reference clip at
ROOT/backend/veyra/voice/samples/master_judah.wav to clone Master Judah's voice.

torchaudio's new torchcodec backend requires FFmpeg DLLs on Windows, which are not
present in this environment. We patch torchaudio.load to use soundfile instead;
the patch must happen before any TTS submodule imports torchaudio internally, so it
runs at first synth() call inside _ensure_loaded() before any TTS import.

Timing (CPU, torch 2.12 cpu-only):
  model load  ~21s  (one-time per process)
  latents     ~1.8s (one-time per reference clip)
  synthesis   ~12s  per short sentence
"""

import hashlib
import io
import struct
import threading
import wave
from pathlib import Path

from ..kernel import config as _config
from ..kernel.paths import ROOT, VEYRA_HOME

_MODEL_DEFAULT  = str(ROOT / "models" / "xtts_v2")
_SAMPLE_DEFAULT = str(ROOT / "backend" / "veyra" / "voice" / "samples" / "master_judah.wav")
_CACHE_DEFAULT  = str(VEYRA_HOME / "voice_cache")

_lock  = threading.Lock()
_model = None   # Xtts instance, loaded once
_gpt   = None   # GPT conditioning latents, computed once per reference clip
_spk   = None   # speaker embedding


# ---------------------------------------------------------------------------
# torchaudio soundfile shim (avoids torchcodec/FFmpeg on Windows)
# ---------------------------------------------------------------------------

def _sf_load(path, frame_offset=0, num_frames=-1, normalize=True,
             channels_first=True, format=None, buffer_size=None,
             backend=None, encoding=None):
    import torch
    import numpy as np
    import soundfile as sf
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    t = torch.from_numpy(np.ascontiguousarray(data.T))  # (channels, frames)
    if num_frames > 0:
        t = t[:, frame_offset:frame_offset + num_frames]
    elif frame_offset:
        t = t[:, frame_offset:]
    return t, sr


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def available() -> bool:
    """True when the model checkpoint exists and the TTS/torch packages are importable."""
    try:
        import TTS   # noqa: F401
        import torch  # noqa: F401
    except Exception:
        return False
    model_dir = Path(_config.get("voice_clone_model", _MODEL_DEFAULT))
    return (model_dir / "model.pth").exists() and (model_dir / "config.json").exists()


def voices():
    return [{"id": "master_judah", "name": "Master Judah (cloned)",
             "gender": "Male", "locale": "en-US"}]


def synth(text: str) -> bytes:
    """Return 24 kHz mono WAV bytes in Master Judah's voice. Caches by text hash."""
    cache_dir = Path(_config.get("voice_clone_cache", _CACHE_DEFAULT))
    cache_dir.mkdir(parents=True, exist_ok=True)

    text = text.strip()
    key  = hashlib.md5(text.encode()).hexdigest()
    hit  = cache_dir / f"{key}.wav"
    if hit.exists():
        return hit.read_bytes()

    _ensure_loaded()
    out     = _model.inference(text, "en", _gpt, _spk,
                               temperature=0.7, enable_text_splitting=True)
    samples = out["wav"]

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(struct.pack(
            "<" + "h" * len(samples),
            *[int(max(-32768, min(32767, s * 32767))) for s in samples],
        ))
    wav_bytes = buf.getvalue()
    hit.write_bytes(wav_bytes)
    return wav_bytes


def pre_warm(phrases=None):
    """Synthesise common phrases at startup so first real responses are instant.

    Call this once from the API startup event — it runs on a daemon thread so it
    never delays the server boot.
    """
    _defaults = [
        "Veyra is ready, Master Judah.",
        "Done.",
        "On it.",
        "I couldn't do that. Here's why.",
        "Would you like me to proceed?",
    ]
    targets = phrases or _defaults

    def _warm():
        if not available():
            return
        for phrase in targets:
            try:
                synth(phrase)
            except Exception:
                pass

    t = threading.Thread(target=_warm, daemon=True, name="clone-prewarm")
    t.start()


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

def _ensure_loaded():
    global _model, _gpt, _spk
    if _model is not None:
        return
    with _lock:
        if _model is not None:
            return

        # Patch torchaudio before any TTS submodule touches it
        import torchaudio
        torchaudio.load = _sf_load

        from TTS.tts.configs.xtts_config import XttsConfig
        from TTS.tts.models.xtts import Xtts

        model_dir = _config.get("voice_clone_model", _MODEL_DEFAULT)
        sample    = _config.get("voice_clone_sample", _SAMPLE_DEFAULT)

        cfg = XttsConfig()
        cfg.load_json(str(Path(model_dir) / "config.json"))

        m = Xtts.init_from_config(cfg)
        m.load_checkpoint(cfg, checkpoint_dir=str(model_dir), eval=True)

        gpt_cond, spk_emb = m.get_conditioning_latents(audio_path=[sample])
        _model, _gpt, _spk = m, gpt_cond, spk_emb
