"""Launch the Veyra kernel-backed API.

    C:\\VEYRA\\.venv\\Scripts\\python.exe backend\\server.py

Serves the API and the frontend at http://127.0.0.1:8788. The legacy stdlib server
(backend/main.py, port 8787) remains available during the migration.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

if __name__ == "__main__":
    # 0.0.0.0 so the phone app can reach the engine over your Wi-Fi / tunnel (not just localhost).
    uvicorn.run("veyra.api.app:app", host="0.0.0.0", port=8788, reload=False)
