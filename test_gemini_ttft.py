"""
Test Time-To-First-Token (TTFT) for Gemini models.
Uses streaming to measure how quickly each model begins responding.
"""

import time
import os
import sys
from dotenv import load_dotenv

load_dotenv()

try:
    import google.generativeai as genai
except ImportError:
    print("Installing google-generativeai...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "google-generativeai", "-q"])
    import google.generativeai as genai

MODELS = [
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
]

PROMPT = "Explain what a Python decorator is in one sentence."
RUNS = 3


def get_api_key():
    """Try local .env, then fall back to VM's Agent Zero .env."""
    key = os.environ.get("API_KEY_GOOGLE") or os.environ.get("GOOGLE_API_KEY")
    if key:
        return key
    # Try reading from VM via paramiko
    try:
        import paramiko
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect("172.16.192.94", username="mike", password="mike7106", timeout=10)
        _, stdout, _ = ssh.exec_command("grep API_KEY_GOOGLE /home/mike/agent-zero/.env")
        line = stdout.read().decode().strip()
        ssh.close()
        if "=" in line:
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    print("ERROR: No Google API key found. Set API_KEY_GOOGLE or GOOGLE_API_KEY.")
    sys.exit(1)


def measure_ttft(model_name: str, prompt: str) -> dict:
    """Send a streaming request and measure time to first token and total time."""
    model = genai.GenerativeModel(model_name)
    start = time.perf_counter()
    try:
        response = model.generate_content(prompt, stream=True)
        first_token_time = None
        first_text = ""
        for chunk in response:
            if first_token_time is None and chunk.text:
                first_token_time = time.perf_counter() - start
                first_text = chunk.text[:60]
        total_time = time.perf_counter() - start

        if first_token_time is None:
            return {"status": "no_output", "ttft": None, "total": total_time}

        return {
            "status": "ok",
            "ttft": first_token_time,
            "total": total_time,
            "preview": first_text,
        }
    except Exception as e:
        elapsed = time.perf_counter() - start
        return {"status": "error", "ttft": None, "total": elapsed, "error": str(e)[:80]}


def main():
    api_key = get_api_key()
    genai.configure(api_key=api_key)

    print(f"Prompt: \"{PROMPT}\"")
    print(f"Runs per model: {RUNS}")
    print(f"{'=' * 80}\n")

    results = {}

    for model_name in MODELS:
        print(f"Testing: {model_name}")
        ttfts = []
        totals = []

        for run in range(1, RUNS + 1):
            r = measure_ttft(model_name, PROMPT)
            if r["status"] == "ok":
                ttfts.append(r["ttft"])
                totals.append(r["total"])
                print(f"  Run {run}: TTFT={r['ttft']:.3f}s  Total={r['total']:.3f}s")
            else:
                err = r.get("error", r["status"])
                print(f"  Run {run}: FAILED - {err}")

        if ttfts:
            avg_ttft = sum(ttfts) / len(ttfts)
            min_ttft = min(ttfts)
            avg_total = sum(totals) / len(totals)
            results[model_name] = {
                "avg_ttft": avg_ttft,
                "min_ttft": min_ttft,
                "avg_total": avg_total,
                "runs_ok": len(ttfts),
            }
        else:
            results[model_name] = None
        print()

    # Summary table
    print("=" * 80)
    print(f"{'MODEL':<30} {'AVG TTFT':>10} {'MIN TTFT':>10} {'AVG TOTAL':>10} {'RUNS':>6}")
    print("-" * 80)

    ranked = sorted(
        [(k, v) for k, v in results.items() if v],
        key=lambda x: x[1]["avg_ttft"],
    )

    for model_name, data in ranked:
        print(
            f"{model_name:<30} "
            f"{data['avg_ttft']:>9.3f}s "
            f"{data['min_ttft']:>9.3f}s "
            f"{data['avg_total']:>9.3f}s "
            f"{data['runs_ok']:>5}/{RUNS}"
        )

    for model_name, data in results.items():
        if data is None:
            print(f"{model_name:<30} {'FAILED':>10} {'--':>10} {'--':>10} {'0/' + str(RUNS):>6}")

    print("=" * 80)

    if ranked:
        winner = ranked[0]
        print(f"\nFastest TTFT: {winner[0]} ({winner[1]['avg_ttft']:.3f}s avg)")


if __name__ == "__main__":
    main()
