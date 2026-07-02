# Emblem Voice Clone + Agentic Brain Integration

## Voice Clone (XTTS-v2)

### Files
| File | Change |
|---|---|
| `backend/emblem/voice/clone_engine.py` | **New.** XTTS-v2: available(), voices(), synth(text), pre_warm() |
| `backend/emblem/voice/service.py` | clone branch in tts(), list_voices(), engines() |
| `backend/emblem/api/app.py` | _startup() calls pre_warm() on daemon thread |
| `frontend/src/screens/Settings.svelte` | "Master Judah (cloned)" option + CPU info row |

### Model paths
```
C:\EMBLEM AI\models\xtts_v2\                                   ← 1.8 GB model
C:\EMBLEM AI\backend\emblem\voice\samples\master_judah.wav      ← reference clip
C:\EMBLEM AI\backend\emblem\voice\cache\                        ← auto-created cache
```

### CPU timing (measured)
- Model load: ~21s (one-time per process)
- Speaker latents: ~1.8s (one-time)
- Synthesis: ~12s per sentence (cached on 2nd call: instant)

### torchaudio fix
torchcodec needs FFmpeg DLLs on Windows — patched to soundfile inside _ensure_loaded().

### Config keys
```
voice_engine         = "clone"
voice_clone_model    (default: ROOT/models/xtts_v2)
voice_clone_sample   (default: ROOT/backend/emblem/voice/samples/master_judah.wav)
voice_clone_cache    (default: .emblem/voice_cache)
```

Fallback: if clone unavailable → Edge Neural automatically.

---

## Agentic Brain Upgrade

### Secrets stored (DPAPI-encrypted in kernel.db)
cerebras_key_2, groq_key, gemini_key, resend_key, render_key,
emblem_pg, emblem_pg_pooler, supabase_url, supabase_anon_key,
supabase_service_key, supabase_access_token

### Brain dispatch chain (agent/brain.py)
```
Text:       Cerebras key-1 → Cerebras key-2 → Groq → friendly error
Tool calls: Cerebras key-1 → Cerebras key-2 → Groq → OpenAI → friendly error
Vision:     Gemini gemini-2.0-flash (inline base64, free)
Embeddings: Gemini text-embedding-004 (768 dims, free)
```

### New: analyze tool (tools/analyze.py)
- analyze.image  — image file → Gemini Vision → description
- analyze.ask    — any doc → extract text → ask AI a question

### docread.py
docs.read now handles png/jpg/gif/webp/bmp/tiff → routes to brain.chat_vision().

---

## Next: P0 Security
emblem_pg is still the admin DSN — replace with scoped roles (see EMBLEM_UPGRADE_BRIEF.md §4).
