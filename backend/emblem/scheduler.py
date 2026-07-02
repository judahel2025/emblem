"""Background scheduler — fires recurring tasks on their own.

Runs as a daemon thread inside the API process. Every tick it finds due tasks and executes
their tool through the kernel (so kill-switch / approval-mode / audit all still apply), then
advances next_run and decrements the remaining run count.

Two stores:
  • local SQLite (kernel.db scheduled_tasks) — runs inside the desktop engine; fires while the
    app/PC is on and catches up on anything overdue at boot.
  • cloud Supabase (public.scheduled_tasks) — runs inside the Fly cloud deploy so daily tasks
    fire even when the PC is off. A `claimed_at` lease stops two workers double-firing.

Tasks created with where='cloud' are marked 'delegated' locally so only the cloud runs them
(no double send). Default is local.
"""

import json
import os
import threading
import time
import traceback

from .kernel import context, db
from . import kernel as kernel_facade

_TICK_SECS = 30
_started = False

_OWNER_UID = os.environ.get("EMBLEM_OWNER_USER_ID", "")


def _bind_task_user(row):
    """Bind the stored owner of a scheduled row so its tools stay user-scoped.
    Rows with no user (legacy/system monitors) run as the admin/service principal."""
    uid = (row.get("user_id") if isinstance(row, dict) else None) or _OWNER_UID or None
    return context.set_user(uid, context.SERVICE_PRINCIPAL if not row.get("user_id") else "user")


# --- local store -----------------------------------------------------------------
def _run_one_local(row):
    tool = row["tool"]
    try:
        args = json.loads(row["args_json"] or "{}")
    except Exception:
        args = {}
    tokens = _bind_task_user(row)
    try:
        result = kernel_facade.execute_tool(tool, args, actor="scheduler")
        summary = (result if isinstance(result, str) else json.dumps(result, default=str))[:300]
        ok = True
    except Exception as exc:
        summary = f"error: {exc}"
        ok = False
    finally:
        context.reset(tokens)
    runs_done = (row["runs_done"] or 0) + 1
    done = runs_done >= (row["runs_total"] or 1)
    db.write(
        "UPDATE scheduled_tasks SET runs_done = ?, last_run = datetime('now'), last_result = ?, "
        "status = ?, next_run = datetime('now', ?) WHERE id = ?",
        (runs_done, summary, "done" if done else "active",
         f"+{int(row['every_secs'] or 86400)} seconds", row["id"]),
    )
    return ok


def _tick_local():
    due = db.query(
        "SELECT * FROM scheduled_tasks WHERE status = 'active' AND next_run <= datetime('now') "
        "ORDER BY next_run ASC LIMIT 20"
    )
    for row in due:
        try:
            _run_one_local(row)
        except Exception:
            traceback.print_exc()
    return len(due)


# --- cloud store (Supabase) ------------------------------------------------------
def _cloud_conn():
    from .kernel import vault
    ci = vault.get_secret("emblem_pg") or os.environ.get("EMBLEM_PG")
    if not ci:
        return None
    import psycopg
    return psycopg.connect(ci, sslmode="require", connect_timeout=20, autocommit=True)


def _tick_cloud():
    conn = _cloud_conn()
    if conn is None:
        return 0
    n = 0
    try:
        with conn:
            cur = conn.cursor()
            # claim due tasks with a 5-minute lease so two workers don't double-fire
            cur.execute(
                "UPDATE public.scheduled_tasks SET claimed_at = now() "
                "WHERE id IN (SELECT id FROM public.scheduled_tasks WHERE status='active' "
                "AND next_run <= now() AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes') "
                "ORDER BY next_run ASC LIMIT 20 FOR UPDATE SKIP LOCKED) "
                "RETURNING id, tool, args_json, every_secs, runs_done, runs_total, user_id")
            rows = cur.fetchall()
            for tid, tool, args_json, every, runs_done, runs_total, task_uid in rows:
                try:
                    args = json.loads(args_json or "{}")
                except Exception:
                    args = {}
                tokens = _bind_task_user({"user_id": task_uid})
                try:
                    result = kernel_facade.execute_tool(tool, args, actor="cloud-scheduler")
                    summary = (result if isinstance(result, str) else json.dumps(result, default=str))[:300]
                except Exception as exc:
                    summary = f"error: {exc}"
                finally:
                    context.reset(tokens)
                rd = (runs_done or 0) + 1
                done = rd >= (runs_total or 1)
                cur.execute(
                    "UPDATE public.scheduled_tasks SET runs_done=%s, last_run=now(), last_result=%s, "
                    "status=%s, next_run = now() + (%s || ' seconds')::interval, claimed_at=NULL WHERE id=%s",
                    (rd, summary, "done" if done else "active", int(every or 86400), tid))
                n += 1
    except Exception:
        traceback.print_exc()
    return n


def mirror_to_cloud(title, tool, args, every_secs, runs_total, first_delay_secs=0):
    """Create a task row in the cloud store (used when where='cloud')."""
    conn = _cloud_conn()
    if conn is None:
        return False
    uid = context.user_id() if context.multiuser() else None
    try:
        with conn:
            conn.execute(
                "INSERT INTO public.scheduled_tasks (title, tool, args_json, every_secs, next_run, runs_total, status, user_id) "
                "VALUES (%s, %s, %s, %s, now() + (%s || ' seconds')::interval, %s, 'active', %s)",
                (title, tool, json.dumps(args or {}), every_secs, first_delay_secs, runs_total, uid))
        return True
    except Exception:
        traceback.print_exc()
        return False


# --- automations (natural-language recurring tasks, per user) ---------------------
_automation_running = set()   # ids currently executing — never stack overlapping runs


def _quiet_now(uid):
    """True when the user's quiet hours are active (default 22:00–07:00 UTC)."""
    try:
        from .kernel import data as ddb
        row = ddb.one("SELECT quiet_start, quiet_end FROM profiles WHERE user_id = ?", (uid,))
        qs = (row or {}).get("quiet_start") or "22:00"
        qe = (row or {}).get("quiet_end") or "07:00"
    except Exception:
        qs, qe = "22:00", "07:00"
    now = time.strftime("%H:%M", time.gmtime())
    return (qs <= now or now < qe) if qs > qe else (qs <= now < qe)


def _run_one_automation(row):
    aid = row["id"]
    if aid in _automation_running:
        return  # previous run still going — skip, don't stack
    _automation_running.add(aid)
    tokens = context.set_user(row.get("user_id"), "user")
    try:
        from .agent.loop import run as agent_run
        result = agent_run(row["instruction"], {})
        reply = (result or {}).get("reply", "")[:280]
        from . import alerts
        alerts.raise_alert("automation", row.get("title") or "Automation ran", reply,
                           user_id=row.get("user_id"))
        summary = reply or "ran"
    except Exception as exc:
        summary = f"error: {exc}"
    finally:
        _automation_running.discard(aid)
        context.reset(tokens)
    from .kernel import data as ddb
    ddb.write(
        "UPDATE automations SET last_run = datetime('now'), last_result = ?, "
        "next_run = datetime('now', ?) WHERE id = ?",
        (summary[:300], f"+{int(row.get('every_secs') or 86400)} seconds", aid),
    )


def _tick_automations():
    try:
        from .kernel import data as ddb
        due = ddb.query(
            "SELECT id, title, instruction, every_secs, quiet_aware, user_id "
            "FROM automations WHERE enabled = ? AND next_run <= datetime('now') "
            "ORDER BY next_run ASC LIMIT 10", (True,))
    except Exception:
        return 0
    n = 0
    for row in due:
        if row.get("quiet_aware") and row.get("user_id") and _quiet_now(row["user_id"]):
            continue  # hold until waking hours; next tick re-checks
        try:
            _run_one_automation(row)
            n += 1
        except Exception:
            traceback.print_exc()
    return n


# --- public tick + loop ----------------------------------------------------------
def tick():
    n = _tick_local()
    n += _tick_automations()
    if os.environ.get("EMBLEM_CLOUD") == "1":
        n += _tick_cloud()
    return n


def _loop():
    # small initial delay so the API finishes booting, then catch up immediately
    time.sleep(3)
    while True:
        try:
            tick()
        except Exception:
            traceback.print_exc()
        time.sleep(_TICK_SECS)


def start():
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, name="emblem-scheduler", daemon=True).start()
